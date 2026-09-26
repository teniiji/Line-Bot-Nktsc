import { prisma } from "@/lib/prisma";
import {
  type DepositLine,
  type SlipRecord,
  honourLiveLinks,
  reconcileDay,
} from "@/lib/dailyReconcile";
import { OTHER_CHANNEL } from "@/lib/statementLines";

const DAY_MS = 24 * 60 * 60 * 1000;

// The เงินเข้าประจำวัน pairing — the money in over [start, end) against the
// slips members sent for it — as the daily page builds it. Here rather than
// in the route so anything else that needs to know "whose is this line" (the
// carried debts, for one) gets the same answer the page shows staff.
//
// accountOwners can be passed in by a caller reconciling many windows, so the
// directory and the rounds' account lists are read once rather than per day.
export async function loadAccountOwners(): Promise<Map<string, string>> {
  const [directory, roundMembers] = await Promise.all([
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
  return accountOwners;
}

export async function loadReconciliation(
  start: Date,
  end: Date,
  knownOwners?: Map<string, string>
) {
  // Slips reach a day either side, because a member who transfers late in the
  // evening is posted by the bank the next morning — and because members
  // sometimes file the slip the day after they sent it. reconcileDay prefers
  // a same-day pairing and marks the rest, so widening the window costs
  // nothing but catches the skew.
  const slipWindowStart = new Date(start.getTime() - DAY_MS);
  const slipWindowEnd = new Date(end.getTime() + DAY_MS);

  const [lines, slips, accountOwners] = await Promise.all([
    prisma.statementLine.findMany({
      where: { postedAt: { gte: start, lt: end } },
      orderBy: { postedAt: "asc" },
    }),
    prisma.expense.findMany({
      // A share of a line staff divided among members is not a slip to pair:
      // the line it came from is already accounted for, by its splits.
      where: { date: { gte: slipWindowStart, lt: slipWindowEnd }, splitFromLineId: null, setAsideFromId: null },
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
    knownOwners ?? loadAccountOwners(),
  ]);

  // The bank's own postings are not a member paying in, so they are not part
  // of the reconciliation — but they are still money that moved, so they are
  // returned separately rather than dropped. Staff seeing an unfamiliar code
  // sitting in อื่นๆ is how a channel that should have been counted gets
  // noticed.
  // Lines staff divided among several members (lib/unitPayer.ts) are
  // accounted for already, and stay out of the pairing — they are returned
  // on their own so the page can show who got what.
  const splitRows = lines.length
    ? await prisma.statementLineSplit.findMany({
        where: { lineId: { in: lines.map((line) => line.id) } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const splits = new Map<string, { memberNumber: string; amount: number }[]>();
  for (const row of splitRows) {
    splits.set(row.lineId, [...(splits.get(row.lineId) ?? []), { memberNumber: row.memberNumber, amount: row.amount }]);
  }

  const deposits: DepositLine[] = lines
    .filter((line) => line.channel !== OTHER_CHANNEL && !splits.has(line.id))
    .map((line) => ({
      id: line.id,
      amount: line.amount,
      postedAt: line.postedAt,
      senderAccount: line.senderAccount,
      channel: line.channel,
      branch: line.branch,
      description: line.description,
    }));

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

  const result = reconcileDay(deposits, slipRecords, accountOwners);

  return { lines, slips, accountOwners, result, splits };
}
