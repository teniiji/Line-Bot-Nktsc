import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DepositLine, SlipRecord, reconcileDay } from "@/lib/dailyReconcile";
import { OTHER_CHANNEL } from "@/lib/statementLines";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

// One day's money in against the slips members sent that day.
//
// Statement timestamps hold the bank's wall clock in UTC (see
// parseStatementDate) and slip dates are stored as plain days, so the window
// is built in UTC too — reading either in the server's timezone would shift
// the boundary and move payments made near midnight into the wrong day.
export async function GET(request: NextRequest) {
  const dateParam = request.nextUrl.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json({ error: "ต้องระบุวันที่ (YYYY-MM-DD)" }, { status: 400 });
  }

  const start = new Date(`${dateParam}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: "วันที่ไม่ถูกต้อง" }, { status: 400 });
  }
  const end = new Date(start.getTime() + DAY_MS);

  // Slips reach a day either side, because a member who transfers late in the
  // evening is posted by the bank the next morning — and because members
  // sometimes file the slip the day after they sent it. reconcileDay prefers
  // a same-day pairing and marks the rest, so widening the window costs
  // nothing but catches the skew.
  const slipWindowStart = new Date(start.getTime() - DAY_MS);
  const slipWindowEnd = new Date(end.getTime() + DAY_MS);

  const [lines, slips, directory, roundMembers] = await Promise.all([
    prisma.statementLine.findMany({
      where: { postedAt: { gte: start, lt: end } },
      orderBy: { postedAt: "asc" },
    }),
    prisma.expense.findMany({
      where: { date: { gte: slipWindowStart, lt: slipWindowEnd } },
      orderBy: { date: "asc" },
      select: {
        id: true,
        amount: true,
        date: true,
        category: true,
        memberNumber: true,
        memberFullName: true,
        slipImageUrl: true,
        slipTransferTime: true,
        slipSenderAccount: true,
        statementLineId: true,
      },
    }),
    prisma.memberBankAccount.findMany({ select: { accountNumber: true, memberNumber: true } }),
    // The rounds' own lists are a second, much larger source of "this account
    // belongs to this member" — the หักไม่ได้ sheet carries an account number
    // for most members, while the directory only holds the ones staff have
    // bound by hand. Without it almost every payment on a busy day reads as
    // "nobody knows who this is", and the list staff actually need to chase
    // drowns in it.
    prisma.statementMember.findMany({
      where: { accountNumber: { not: null } },
      select: { accountNumber: true, memberNumber: true },
    }),
  ]);

  // The bank's own postings are not a member paying in, so they are not part
  // of the reconciliation — but they are still money that moved, so they are
  // returned separately rather than dropped. Staff seeing an unfamiliar code
  // sitting in อื่นๆ is how a channel that should have been counted gets
  // noticed.
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

  // Slips outside the day itself only count when they pair with money on it;
  // on their own they belong to their own day's view, not this one.
  const sameDay = (date: Date) => date >= start && date < end;
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

  // Round lists first, then the directory over the top: a binding staff made
  // by hand is the more deliberate statement of who an account belongs to, so
  // it wins where the two disagree.
  const accountOwners = new Map<string, string>();
  for (const member of roundMembers) {
    if (member.accountNumber) accountOwners.set(member.accountNumber, member.memberNumber);
  }
  for (const entry of directory) {
    accountOwners.set(entry.accountNumber, entry.memberNumber);
  }

  const result = reconcileDay(deposits, slipRecords, accountOwners);
  const slipImages = new Map(slips.map((slip) => [slip.id, slip.slipImageUrl]));

  const describeSlip = (slip: SlipRecord) => ({
    id: slip.id,
    amount: slip.amount,
    date: slip.date.toISOString(),
    memberNumber: slip.memberNumber,
    memberFullName: slip.memberFullName,
    category: slip.category,
    transferTime: slip.transferTime,
    senderAccount: slip.senderAccount,
    slipImageUrl: slipImages.get(slip.id) ?? null,
    // Staff-recorded transactions have no slip to look at, and saying so is
    // what stops the "ดูสลิป" column reading as a missing file.
    statementLineId: slip.statementLineId,
  });

  const describeDeposit = (deposit: DepositLine) => ({
    id: deposit.id,
    amount: deposit.amount,
    postedAt: deposit.postedAt?.toISOString() ?? null,
    senderAccount: deposit.senderAccount,
    channel: deposit.channel,
    branch: deposit.branch,
    description: deposit.description,
    // Who the directory says the paying account belongs to, so staff can act
    // on an unclaimed payment without looking it up separately.
    memberNumber: deposit.senderAccount
      ? (accountOwners.get(deposit.senderAccount) ?? null)
      : null,
  });

  const unclaimedSlips = result.slipsWithoutMoney.filter((slip) => sameDay(slip.date));

  return NextResponse.json({
    date: dateParam,
    matched: result.matched.map((pair) => ({
      deposit: describeDeposit(pair.deposit),
      slip: describeSlip(pair.slip),
      basis: pair.basis,
      dayApart: pair.dayApart,
      minutesApart: pair.minutesApart,
    })),
    slipsWithoutMoney: unclaimedSlips.map(describeSlip),
    depositsWithoutSlip: result.depositsWithoutSlip.map(describeDeposit),
    otherLines: lines
      .filter((line) => line.channel === OTHER_CHANNEL)
      .map((line) => ({
        id: line.id,
        amount: line.amount,
        postedAt: line.postedAt?.toISOString() ?? null,
        txnCode: line.txnCode,
        description: line.description,
        branch: line.branch,
      })),
    totals: {
      ...result.totals,
      // Recomputed from what is actually shown: reconcileDay counted every
      // slip in the widened window, including neighbours that paired with
      // nothing here.
      slipCount: result.matched.length + unclaimedSlips.length,
      slipAmount:
        Math.round(
          [...result.matched.map((m) => m.slip.amount), ...unclaimedSlips.map((s) => s.amount)]
            .reduce((total, value) => total + value, 0) * 100
        ) / 100,
    },
    loaded: lines.length > 0,
  });
}
