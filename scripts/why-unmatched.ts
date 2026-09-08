// Read-only: why a slip and the money it should have paired with did not
// pair.
//
// The daily view says "มีสลิปแต่ไม่เจอเงินเข้า" and staff can see the money
// sitting in the statement file in front of them. The view cannot say why,
// because reconcileDay only reports the pairs it made — every gate a
// candidate failed is discarded on the way. This walks the same gates in the
// same order and prints the one that closed.
//
// Nothing is written. Run it against production and read the output.
//
// Usage: npx tsx scripts/why-unmatched.ts <YYYY-MM-DD> [amount]
//   e.g. npx tsx scripts/why-unmatched.ts 2026-09-08 4200

import { DepositLine, SlipRecord, reconcileDay } from "../lib/dailyReconcile";
import { CHANNEL_LABELS, OTHER_CHANNEL } from "../lib/statementLines";
import { compareSlipAccount, normalizeAccountPattern, slipTimeMinutes } from "../lib/slipDetails";
import { formatAmount } from "../lib/format";
import { scriptPrisma } from "./prismaClient";

const prisma = scriptPrisma("statementLine", "expense", "memberBankAccount", "statementMember");
const DAY_MS = 24 * 60 * 60 * 1000;

const clock = (date: Date | null) => (date ? date.toISOString().slice(11, 16) : "--:--");
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

async function main() {
  const [dayArg, amountArg] = process.argv.slice(2);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayArg ?? "")) {
    console.error("Usage: npx tsx scripts/why-unmatched.ts <YYYY-MM-DD> [amount]");
    process.exit(1);
  }
  const onlyAmount = amountArg ? Number(amountArg.replace(/,/g, "")) : null;
  if (amountArg && !Number.isFinite(onlyAmount)) {
    console.error(`ยอดเงินไม่ถูกต้อง: ${amountArg}`);
    process.exit(1);
  }

  // Same UTC windows as app/api/daily-reconcile/route.ts — reading either in
  // the server's timezone would move payments near midnight into another day.
  const start = new Date(`${dayArg}T00:00:00.000Z`);
  const end = new Date(start.getTime() + DAY_MS);

  const [lines, slips, directory, roundMembers] = await Promise.all([
    prisma.statementLine.findMany({
      where: { postedAt: { gte: start, lt: end } },
      orderBy: { postedAt: "asc" },
    }),
    prisma.expense.findMany({
      where: { date: { gte: new Date(start.getTime() - DAY_MS), lt: new Date(end.getTime() + DAY_MS) } },
      orderBy: { date: "asc" },
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
    prisma.memberBankAccount.findMany({ select: { accountNumber: true, memberNumber: true } }),
    prisma.statementMember.findMany({
      where: { accountNumber: { not: null } },
      select: { accountNumber: true, memberNumber: true },
    }),
  ]);

  // Round lists first, then the hand-made directory over the top, exactly as
  // the daily view resolves them. Kept separately as well, so the report can
  // say which of the two named an owner.
  const accountOwners = new Map<string, string>();
  const ownerSource = new Map<string, string>();
  for (const member of roundMembers) {
    if (member.accountNumber) {
      accountOwners.set(member.accountNumber, member.memberNumber);
      ownerSource.set(member.accountNumber, "รายชื่อหักไม่ได้ (StatementMember)");
    }
  }
  for (const entry of directory) {
    accountOwners.set(entry.accountNumber, entry.memberNumber);
    ownerSource.set(entry.accountNumber, "ทะเบียนเลขบัญชี (MemberBankAccount)");
  }

  console.log(`วันที่ตรวจ: ${dayArg}${onlyAmount !== null ? ` · เฉพาะยอด ${formatAmount(onlyAmount)}` : ""}`);
  console.log("=".repeat(74));

  // Step 0, and the most common answer: the money is not in the database at
  // all. Broken out per account because the two are uploaded separately and
  // it is easy to load one and believe both are loaded.
  const byAccount = new Map<string, number>();
  for (const line of lines) byAccount.set(line.account, (byAccount.get(line.account) ?? 0) + 1);
  console.log(`\nรายการเดินบัญชีที่มีในระบบของวันนี้: ${lines.length} รายการ`);
  if (byAccount.size === 0) {
    console.log("  ⛔ ไม่มีเลย — ยังไม่ได้อัปโหลด statement ของวันนี้");
  }
  for (const [account, count] of byAccount) {
    console.log(`  บัญชี ${account}: ${count} รายการ`);
  }

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

  const result = reconcileDay(deposits, slipRecords, accountOwners);
  const claimedDeposit = new Map<string, SlipRecord>();
  for (const pair of result.matched) claimedDeposit.set(pair.deposit.id, pair.slip);

  const unmatched = result.slipsWithoutMoney
    .filter((slip) => slip.date >= start && slip.date < end)
    .filter((slip) => onlyAmount === null || near(slip.amount, onlyAmount));

  console.log(`\nสลิปที่ยังจับคู่ไม่ได้ (ในวันนี้): ${unmatched.length} ใบ`);
  if (unmatched.length === 0) {
    console.log("ไม่มีอะไรต้องอธิบาย");
    return;
  }

  for (const slip of unmatched) {
    console.log("\n" + "=".repeat(74));
    console.log(
      `สลิป ${formatAmount(slip.amount)} · ${slip.memberFullName ?? "ไม่ทราบชื่อ"} ` +
        `· เลขสมาชิก "${slip.memberNumber ?? "-"}"`
    );
    console.log(
      `  วันที่บนสลิป ${slip.date.toISOString().slice(0, 10)} ${slip.transferTime ?? "(ไม่มีเวลา)"} ` +
        `· บัญชีผู้โอนบนสลิป "${slip.senderAccount ?? "-"}"`
    );
    const pattern = normalizeAccountPattern(slip.senderAccount);
    console.log(`  เลขบัญชีบนสลิปหลังแปลง: ${pattern ?? "(ใช้ไม่ได้ — ตัวเลขที่เห็นน้อยเกินไป)"}`);

    // Every deposit of the same amount is a candidate; anything else could
    // never have paired, so listing it would only add noise.
    const sameAmount = deposits.filter((d) => near(d.amount, slip.amount));
    if (sameAmount.length === 0) {
      console.log(
        `\n  ⛔ สาเหตุ: ไม่มีเงินเข้ายอด ${formatAmount(slip.amount)} ในระบบเลยของวันนี้`
      );
      const anyAccount = lines.filter((l) => near(l.amount, slip.amount));
      if (anyAccount.length > 0) {
        // The line exists but is not counted as a member paying in.
        for (const line of anyAccount) {
          console.log(
            `     พบบรรทัดยอดนี้ในบัญชี ${line.account} เวลา ${clock(line.postedAt)} ` +
              `รหัส ${line.txnCode} → ถูกจัดเป็น "${CHANNEL_LABELS[line.channel] ?? line.channel}" ` +
              `จึงไม่นับเป็นเงินสมาชิกโอนเข้า`
          );
        }
      } else {
        console.log("     → ยังไม่ได้อัปโหลดไฟล์ของบัญชีที่เงินเข้า หรือเงินเข้าคนละวัน");
      }
      continue;
    }

    console.log(`\n  เงินเข้ายอดเดียวกันในวันนี้: ${sameAmount.length} รายการ — ไล่ทีละรายการ:`);
    for (const deposit of sameAmount) {
      console.log(
        `\n  • ${clock(deposit.postedAt)} ${formatAmount(deposit.amount)} ` +
          `บัญชี ${deposit.branch} · ผู้โอน "${deposit.senderAccount ?? "-"}" · ${deposit.description}`
      );

      // Gate 1: a directory owner that contradicts the slip. This is the gate
      // that produces the most confusing outcome, because the deposit then
      // shows up under "รู้ว่าใครโอน" with a member number that looks like
      // the same person written differently.
      const owner = deposit.senderAccount ? accountOwners.get(deposit.senderAccount) : undefined;
      if (owner && slip.memberNumber && owner !== slip.memberNumber) {
        console.log(
          `    ⛔ ถูกปฏิเสธ: ทะเบียนบอกว่าบัญชี ${deposit.senderAccount} เป็นของเลขสมาชิก ` +
            `"${owner}" แต่สลิปเป็นของ "${slip.memberNumber}"`
        );
        console.log(`       ที่มาของทะเบียน: ${ownerSource.get(deposit.senderAccount!)}`);
        if (owner.replace(/^0+/, "") === slip.memberNumber.replace(/^0+/, "")) {
          console.log(
            `       ⚠️ สองเลขนี้ต่างกันแค่เลขศูนย์นำหน้า — เป็นคนเดียวกัน แต่ระบบเทียบแบบตรงตัว จึงมองว่าคนละคน`
          );
        }
        continue;
      }

      // Gate 2: the slip's own account contradicting the statement's.
      const verdict = compareSlipAccount(slip.senderAccount, deposit.senderAccount);
      if (verdict === "conflict") {
        console.log(
          `    ⛔ ถูกปฏิเสธ: เลขบัญชีบนสลิป (${pattern}) ขัดกับเลขบัญชีผู้โอนใน statement ` +
            `(${deposit.senderAccount}) — ถือว่าคนละบัญชี`
        );
        continue;
      }

      // Nothing refused it, so it was a real candidate: either it lost the
      // deposit to a better-supported slip, or it should have paired.
      const slipMinutes = slipTimeMinutes(slip.transferTime);
      const basis =
        owner && slip.memberNumber && owner === slip.memberNumber
          ? "เลขบัญชีตรง"
          : verdict === "match"
            ? "บัญชีในสลิปตรง"
            : slipMinutes !== null && deposit.postedAt
              ? "เวลาใกล้กัน / ยอดตรงเท่านั้น"
              : "ยอดตรงเท่านั้น";
      const winner = claimedDeposit.get(deposit.id);
      if (winner) {
        console.log(
          `    ↔️ เข้าเกณฑ์ได้ (${basis}) แต่เงินก้อนนี้ถูกสลิปอื่นจับคู่ไปแล้ว: ` +
            `${winner.memberFullName ?? "-"} เลขสมาชิก "${winner.memberNumber ?? "-"}" ` +
            `(${formatAmount(winner.amount)})`
        );
      } else {
        console.log(
          `    ❓ ไม่มีเกณฑ์ไหนปฏิเสธ และเงินก้อนนี้ก็ไม่มีใครจับคู่ — ควรจะจับคู่ได้ (${basis}). ` +
            `ถ้ายังไม่จับคู่ ให้ส่ง output นี้มาดู`
        );
      }
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
