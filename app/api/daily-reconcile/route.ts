import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DepositLine, SlipRecord, honourLiveLinks, reconcileDay } from "@/lib/dailyReconcile";
import { OTHER_CHANNEL } from "@/lib/statementLines";
import { statementLineStatus } from "@/lib/statementDayView";
import { memberNumberKey } from "@/lib/memberNumber";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

// Inclusive on both ends, so this allows 32 calendar days.
const MAX_RANGE_DAYS = 31;

// The money in over a span of days, against the slips members sent for it.
//
// Usually one day — the tab is a daily job — but staff chasing a payment do
// not always know which day it landed on, so the window is a range. A single
// date is the same thing with from and to equal, and is still accepted on its
// own for that reason.
//
// Statement timestamps hold the bank's wall clock in UTC (see
// parseStatementDate) and slip dates are stored as plain days, so the window
// is built in UTC too — reading either in the server's timezone would shift
// the boundary and move payments made near midnight into the wrong day.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const dateParam = params.get("date") ?? "";
  const fromParam = params.get("from") || dateParam;
  const toParam = params.get("to") || dateParam;
  const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!isDay(fromParam) || !isDay(toParam)) {
    return NextResponse.json({ error: "ต้องระบุวันที่ (YYYY-MM-DD)" }, { status: 400 });
  }

  const start = new Date(`${fromParam}T00:00:00.000Z`);
  const lastDay = new Date(`${toParam}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(lastDay.getTime())) {
    return NextResponse.json({ error: "วันที่ไม่ถูกต้อง" }, { status: 400 });
  }
  if (lastDay < start) {
    return NextResponse.json({ error: "วันเริ่มต้นต้องไม่เกินวันสิ้นสุด" }, { status: 400 });
  }
  // Bounded because the pairing compares every deposit against every slip in
  // the window: a mistyped year would otherwise ask for a decade of both.
  // A month is the working unit here, so a month is the cap.
  if (lastDay.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    return NextResponse.json(
      { error: `เลือกช่วงได้ครั้งละไม่เกิน ${MAX_RANGE_DAYS + 1} วัน` },
      { status: 400 }
    );
  }
  const end = new Date(lastDay.getTime() + DAY_MS);

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

  // Slips outside the window itself only count when they pair with money
  // inside it; on their own they belong to their own day's view, not this one.
  const inRange = (date: Date) => date >= start && date < end;
  const linkedSlips: SlipRecord[] = slips.map((slip) => ({
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

  // A link to a bank line that is no longer stored is dropped rather than
  // honoured — see honourLiveLinks for the pair of lists it otherwise strands
  // a payment on. Asked of the database rather than of this window's lines,
  // because a link pointing outside the window is still a live link.
  const linkedIds = [
    ...new Set(
      linkedSlips
        .map((slip) => slip.statementLineId)
        .filter((id): id is string => id !== null)
    ),
  ];
  const inWindow = new Set(lines.map((line) => line.id));
  const unknownIds = linkedIds.filter((id) => !inWindow.has(id));
  const liveElsewhere = unknownIds.length
    ? await prisma.statementLine.findMany({
        where: { id: { in: unknownIds } },
        select: { id: true },
      })
    : [];
  const slipRecords = honourLiveLinks(
    linkedSlips,
    new Set([...inWindow, ...liveElsewhere.map((line) => line.id)])
  );

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
  // As stored, not as reconciled: a dropped link still means a person
  // recorded this from the statement, and the column that says so is
  // answering "why is there no image", which is as true as it ever was.
  const recordedFromLine = new Map(slips.map((slip) => [slip.id, slip.statementLineId]));

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
    statementLineId: recordedFromLine.get(slip.id) ?? null,
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

  // The same day again, in the bank's order rather than by conclusion — see
  // lib/statementDayView.ts. Every stored line appears exactly once, so the
  // count here is the count in the file, which is what makes "did it drop
  // something?" answerable at a glance.
  const slipByDeposit = new Map(result.matched.map((pair) => [pair.deposit.id, pair.slip]));
  const resolved = lines.map((line) => {
    const slip = slipByDeposit.get(line.id) ?? null;
    const owner = line.senderAccount ? (accountOwners.get(line.senderAccount) ?? null) : null;
    return { line, slip, owner, memberNumber: slip?.memberNumber ?? owner };
  });

  // A row whose payer was recognised only through the account directory has a
  // member number and nothing else — the name lives in the roster, not on the
  // bank line, so without this the column reads "27111" and staff have to look
  // the number up somewhere else to know who to chase. The unit comes with it:
  // chasing a payment means contacting whoever handles that unit.
  const numbersOnPage = [
    ...new Set(
      resolved
        .map((row) => memberNumberKey(row.memberNumber))
        .filter((n): n is string => n !== null)
    ),
  ];
  const [rosterRows, loggedNames] = numbersOnPage.length
    ? await Promise.all([
        prisma.memberRoster.findMany({
          where: { memberNumber: { in: numbersOnPage } },
          select: { memberNumber: true, memberName: true, unitName: true },
        }),
        // The roster is imported from the cooperative's own list and does not
        // carry everyone — a number it has never heard of used to render as
        // nothing but the number. But a member who has ever filed a slip
        // through the bot told it their name at the time, and that is on the
        // transaction. Most recent first, one row per member.
        prisma.expense.findMany({
          where: { memberNumber: { in: numbersOnPage }, memberFullName: { not: null } },
          orderBy: { createdAt: "desc" },
          distinct: ["memberNumber"],
          select: { memberNumber: true, memberFullName: true },
        }),
      ])
    : [[], []];
  const rosterByNumber = new Map(
    rosterRows.map((row) => [memberNumberKey(row.memberNumber) ?? row.memberNumber, row])
  );
  const loggedNameByNumber = new Map(
    loggedNames
      .filter((row) => row.memberNumber && row.memberFullName)
      .map((row) => [memberNumberKey(row.memberNumber) ?? "", row.memberFullName as string])
  );

  const statement = resolved.map(({ line, slip, owner, memberNumber }) => {
    const key = memberNumberKey(memberNumber) ?? "";
    const entry = rosterByNumber.get(key) ?? null;
    return {
      id: line.id,
      postedAt: line.postedAt?.toISOString() ?? null,
      // The bank's own columns, so a person can read straight across from the
      // statement they printed.
      txnCode: line.txnCode,
      description: line.description,
      amount: line.amount,
      balance: line.balance,
      account: line.account,
      branch: line.branch,
      channel: line.channel,
      senderAccount: line.senderAccount,
      status: statementLineStatus({
        isMemberDeposit: line.channel !== OTHER_CHANNEL,
        matched: slip !== null,
        ownerMemberNumber: owner,
      }),
      memberNumber,
      // Roster first — it is the cooperative's own record. Then the name off
      // whatever this member last filed through the bot, which is the only
      // thing that knows a number the roster has never carried. The paired
      // slip is last and usually the same row as the one above it.
      memberName:
        entry?.memberName ?? loggedNameByNumber.get(key) ?? slip?.memberFullName ?? null,
      unitName: entry?.unitName ?? null,
    };
  });

  const unclaimedSlips = result.slipsWithoutMoney.filter((slip) => inRange(slip.date));

  return NextResponse.json({
    // `date` stays the first day of the window, so a caller that only ever
    // asked for one still reads the field it always read.
    date: fromParam,
    from: fromParam,
    to: toParam,
    statement,
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
