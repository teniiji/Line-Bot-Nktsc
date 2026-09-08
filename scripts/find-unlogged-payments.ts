// Read-only audit: money that arrived in the cooperative's accounts with no
// transaction logged against it — and, specifically, the members whose
// payment was lost to the overwrite bug fixed in #90.
//
// Until that fix, PendingTransaction.lineUserId was unique: a member who sent
// a second slip before finishing the first had the first silently replaced,
// and that payment was never logged. Nothing in the database records that it
// happened, so it has to be found the other way round — from the bank's side,
// by looking for money with no slip behind it.
//
// Two things are reported separately, because they need different actions:
//
//   1. THE OVERWRITE SIGNATURE — a member who, on one day, has a logged
//      transaction AND another payment from an account the directory says is
//      theirs, with nothing logged for it. They sent two, one was kept. These
//      are the ones to go back to.
//
//   2. Money nobody claimed at all — no slip, and often no idea who paid. A
//      much larger, older, more ordinary list: plenty of members never send a
//      slip. Worth reading, but it is not evidence of the bug.
//
// Touches nothing. Run it against production and read the output.
//
// Usage: npx tsx scripts/find-unlogged-payments.ts <from YYYY-MM-DD> <to YYYY-MM-DD>
//   e.g. npx tsx scripts/find-unlogged-payments.ts 2026-08-01 2026-09-08

import { PrismaClient } from "@prisma/client";
import { DepositLine, SlipRecord, reconcileDay } from "../lib/dailyReconcile";
import { OTHER_CHANNEL } from "../lib/statementLines";
import { formatAmount } from "../lib/format";

const prisma = new PrismaClient();
const DAY_MS = 24 * 60 * 60 * 1000;

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

interface Finding {
  day: string;
  memberNumber: string | null;
  memberName: string | null;
  amount: number;
  postedAt: Date | null;
  senderAccount: string | null;
  channel: string;
  description: string;
  // What the same member DID get logged that day, when anything was.
  loggedSameDay: { amount: number; category: string | null }[];
}

async function main() {
  const [fromArg, toArg] = process.argv.slice(2);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromArg ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(toArg ?? "")) {
    console.error(
      "Usage: npx tsx scripts/find-unlogged-payments.ts <from YYYY-MM-DD> <to YYYY-MM-DD>"
    );
    process.exit(1);
  }

  const from = new Date(`${fromArg}T00:00:00.000Z`);
  const to = new Date(`${toArg}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    console.error("Invalid date range.");
    process.exit(1);
  }

  // Statement timestamps hold the bank's wall clock in UTC and slip dates are
  // plain days, so every boundary here is UTC too — reading either in the
  // server's timezone would move payments made near midnight into the wrong
  // day. Same rule as app/api/daily-reconcile/route.ts.
  const [directory, roundMembers, roster] = await Promise.all([
    prisma.memberBankAccount.findMany({ select: { accountNumber: true, memberNumber: true } }),
    prisma.statementMember.findMany({
      where: { accountNumber: { not: null } },
      select: { accountNumber: true, memberNumber: true },
    }),
    prisma.memberRoster.findMany({ select: { memberNumber: true, memberName: true } }),
  ]);

  // Round lists first, then the hand-made directory over the top, exactly as
  // the daily view resolves them.
  const accountOwners = new Map<string, string>();
  for (const member of roundMembers) {
    if (member.accountNumber) accountOwners.set(member.accountNumber, member.memberNumber);
  }
  for (const entry of directory) accountOwners.set(entry.accountNumber, entry.memberNumber);
  const nameOf = new Map(roster.map((r) => [r.memberNumber, r.memberName]));

  console.log(`ช่วงที่ตรวจ: ${fromArg} ถึง ${toArg}`);
  console.log(`ทะเบียนเลขบัญชีที่ใช้จับคู่: ${accountOwners.size} บัญชี\n`);

  const overwriteSuspects: Finding[] = [];
  const unclaimed: Finding[] = [];
  let daysWithStatement = 0;
  let totalDeposits = 0;
  let totalDepositAmount = 0;

  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
    const start = new Date(t);
    const end = new Date(t + DAY_MS);
    const day = isoDay(start);

    const [lines, slips] = await Promise.all([
      prisma.statementLine.findMany({
        where: { postedAt: { gte: start, lt: end } },
        orderBy: { postedAt: "asc" },
      }),
      // Slips reach a day either side: a late-evening transfer posts the next
      // morning, and members sometimes file the slip the day after.
      prisma.expense.findMany({
        where: {
          date: { gte: new Date(t - DAY_MS), lt: new Date(t + 2 * DAY_MS) },
        },
        select: {
          id: true,
          amount: true,
          date: true,
          category: true,
          memberNumber: true,
          memberFullName: true,
          slipTransferTime: true,
          slipSenderAccount: true,
          statementLineId: true,
        },
      }),
    ]);

    if (lines.length === 0) continue;
    daysWithStatement++;

    const deposits: DepositLine[] = lines
      .filter((line) => line.channel !== OTHER_CHANNEL)
      .map((line) => ({
        id: line.id,
        amount: line.amount,
        postedAt: line.postedAt,
        senderAccount: line.senderAccount,
        channel: line.channel,
        branch: line.branch,
        description: line.description,
      }));

    const slipRecords: SlipRecord[] = slips.map((slip) => ({
      id: slip.id,
      amount: slip.amount,
      date: slip.date,
      memberNumber: slip.memberNumber,
      memberFullName: slip.memberFullName,
      category: slip.category,
      transferTime: slip.slipTransferTime,
      senderAccount: slip.slipSenderAccount,
      statementLineId: slip.statementLineId,
    }));

    totalDeposits += deposits.length;
    totalDepositAmount += deposits.reduce((sum, d) => sum + d.amount, 0);

    const result = reconcileDay(deposits, slipRecords, accountOwners);

    // What this member did get logged on this day — the other half of the
    // overwrite signature.
    const loggedByMember = new Map<string, { amount: number; category: string | null }[]>();
    for (const pair of result.matched) {
      const member = pair.slip.memberNumber;
      if (!member) continue;
      loggedByMember.set(member, [
        ...(loggedByMember.get(member) ?? []),
        { amount: pair.slip.amount, category: pair.slip.category },
      ]);
    }

    for (const deposit of result.depositsWithoutSlip) {
      const owner = deposit.senderAccount ? (accountOwners.get(deposit.senderAccount) ?? null) : null;
      const finding: Finding = {
        day,
        memberNumber: owner,
        memberName: owner ? (nameOf.get(owner) ?? null) : null,
        amount: deposit.amount,
        postedAt: deposit.postedAt,
        senderAccount: deposit.senderAccount,
        channel: deposit.channel,
        description: deposit.description,
        loggedSameDay: owner ? (loggedByMember.get(owner) ?? []) : [],
      };

      // The signature: their money arrived twice that day and only one of the
      // two has a transaction behind it.
      if (finding.loggedSameDay.length > 0) overwriteSuspects.push(finding);
      else unclaimed.push(finding);
    }
  }

  const time = (date: Date | null) => (date ? date.toISOString().slice(11, 16) : "--:--");

  console.log("=".repeat(72));
  console.log("1) น่าจะโดนบั๊กสลิปทับกัน — เงินเข้า 2 ครั้งในวันเดียว บันทึกแค่ครั้งเดียว");
  console.log("=".repeat(72));
  if (overwriteSuspects.length === 0) {
    console.log("ไม่พบ\n");
  } else {
    for (const f of overwriteSuspects) {
      const logged = f.loggedSameDay
        .map((l) => `${formatAmount(l.amount)} (${l.category ?? "ไม่ระบุหมวด"})`)
        .join(", ");
      console.log(
        `${f.day} ${time(f.postedAt)}  ${formatAmount(f.amount).padStart(14)}  ` +
          `${f.memberNumber} ${f.memberName ?? ""}`
      );
      console.log(`    บัญชีผู้โอน ${f.senderAccount ?? "-"} · ${f.description}`);
      console.log(`    วันเดียวกันบันทึกไว้แล้ว: ${logged}`);
      console.log(`    → รายการนี้ยังไม่ถูกบันทึก`);
    }
    const total = overwriteSuspects.reduce((sum, f) => sum + f.amount, 0);
    console.log(`\nรวม ${overwriteSuspects.length} รายการ ${formatAmount(total)}\n`);
  }

  console.log("=".repeat(72));
  console.log("2) เงินเข้าที่ไม่มีสลิปเลย (ปกติมีจำนวนมาก — ไม่ใช่หลักฐานของบั๊ก)");
  console.log("=".repeat(72));
  const known = unclaimed.filter((f) => f.memberNumber);
  const unknown = unclaimed.filter((f) => !f.memberNumber);
  console.log(
    `รู้ว่าใครโอน (จากทะเบียนเลขบัญชี): ${known.length} รายการ ` +
      `${formatAmount(known.reduce((s, f) => s + f.amount, 0))}`
  );
  console.log(
    `ไม่รู้ว่าใครโอน: ${unknown.length} รายการ ` +
      `${formatAmount(unknown.reduce((s, f) => s + f.amount, 0))}`
  );
  console.log("\nรายการที่รู้ตัวคนโอนแล้ว (ตามด้วยยอด, เรียงมากไปน้อย 30 อันดับแรก):");
  for (const f of [...known].sort((a, b) => b.amount - a.amount).slice(0, 30)) {
    console.log(
      `  ${f.day} ${time(f.postedAt)}  ${formatAmount(f.amount).padStart(14)}  ` +
        `${f.memberNumber} ${f.memberName ?? ""}  [${f.senderAccount ?? "-"}]`
    );
  }

  // Still recoverable without asking anyone: a slip the bot is holding but
  // never finished, because the member stopped replying.
  const stuck = await prisma.pendingTransaction.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      lineUserId: true,
      amount: true,
      category: true,
      hasSlip: true,
      createdAt: true,
      slipImageUrl: true,
    },
  });
  console.log("\n" + "=".repeat(72));
  console.log("3) สลิปที่บอทถืออยู่แต่ยังบันทึกไม่จบ (ยังตามเก็บได้ทันที)");
  console.log("=".repeat(72));
  if (stuck.length === 0) {
    console.log("ไม่มี");
  } else {
    for (const p of stuck) {
      console.log(
        `  ${isoDay(p.createdAt)}  ${p.amount ? formatAmount(p.amount).padStart(14) : "ยังไม่ทราบยอด".padStart(14)}  ` +
          `${p.category ?? "ยังไม่ทราบหมวด"}  ${p.hasSlip ? "มีสลิป" : "ไม่มีสลิป"}  ${p.slipImageUrl ?? ""}`
      );
    }
    console.log(`\nรวม ${stuck.length} รายการ`);
  }

  console.log("\n" + "=".repeat(72));
  console.log(
    `สรุป: มี statement ${daysWithStatement} วัน · เงินเข้าจากสมาชิก ${totalDeposits} รายการ ` +
      `${formatAmount(totalDepositAmount)}`
  );
  console.log(
    "หมายเหตุ: ส่วนที่ 1 เป็น 'น่าจะ' ไม่ใช่ 'แน่นอน' — สมาชิกอาจโอน 2 ครั้งแล้วส่งสลิปมาใบเดียวจริงๆ ก็ได้ " +
      "ให้ใช้เป็นรายการไล่ตรวจ ไม่ใช่ข้อสรุป"
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
