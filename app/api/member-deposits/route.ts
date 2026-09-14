import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { accountsForMember } from "@/lib/memberDeposits";
import { memberNumberKey } from "@/lib/memberNumber";
import { OTHER_CHANNEL } from "@/lib/statementLines";

export const dynamic = "force-dynamic";

// How far back to look. A payment somebody is only now getting round to
// recording is weeks old at most; a year of a busy member's transfers would
// be a list nobody reads.
const LOOKBACK_DAYS = 120;
const MAX_LINES = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Who a member number belongs to, and what they have paid in that nobody has
// recorded yet.
//
// The daily view answers this from the other end: staff open a day, see money
// nobody claimed, ring round, and record it against whoever it turns out to
// be. That is the right way in when the day is what you have.
//
// It is the wrong way in when the member is what you have — somebody at the
// counter, or on the phone, saying they paid. Then the day is the unknown,
// and staff were typing the amount and the date from what the member told
// them, into a form that had no idea the bank had already said the same thing.
//
// So: give it a member number and it finds their money. The amount and date
// still come off the bank line when one is chosen (see
// statement-lines/[id]/record) — this route only says which lines exist.
export async function GET(request: NextRequest) {
  const memberNumber = memberNumberKey(request.nextUrl.searchParams.get("memberNumber") ?? "");
  if (!memberNumber) {
    return NextResponse.json({ error: "ต้องระบุเลขสมาชิก" }, { status: 400 });
  }

  const [roster, directory, roundMembers] = await Promise.all([
    prisma.memberRoster.findUnique({
      where: { memberNumber },
      select: { memberName: true, unitName: true },
    }),
    prisma.memberBankAccount.findMany({ select: { accountNumber: true, memberNumber: true } }),
    prisma.statementMember.findMany({
      where: { accountNumber: { not: null } },
      select: { accountNumber: true, memberNumber: true },
    }),
  ]);

  const accounts = accountsForMember([directory, roundMembers], memberNumber);

  // No account on file means no lines to offer — not an error. Staff can
  // still record by hand, which is what they were doing before this existed.
  const candidates = accounts.length
    ? await prisma.statementLine.findMany({
        where: {
          senderAccount: { in: accounts },
          channel: { not: OTHER_CHANNEL },
          amount: { gt: 0 },
          postedAt: { gte: new Date(Date.now() - LOOKBACK_DAYS * DAY_MS) },
        },
        orderBy: { postedAt: "desc" },
        take: MAX_LINES,
        select: {
          id: true,
          postedAt: true,
          amount: true,
          description: true,
          branch: true,
          channel: true,
          senderAccount: true,
        },
      })
    : [];

  // A line somebody already recorded from must not be offered again. The
  // unique index on Expense.statementLineId would refuse the second one
  // anyway, but being told "already recorded" after picking it is a worse
  // answer than not being shown it.
  const taken = candidates.length
    ? await prisma.expense.findMany({
        where: { statementLineId: { in: candidates.map((line) => line.id) } },
        select: { statementLineId: true },
      })
    : [];
  const recorded = new Set(taken.map((row) => row.statementLineId));

  return NextResponse.json({
    memberNumber,
    // Null when the roster has never heard of this number — staff should see
    // that rather than have it silently treated as a member.
    memberName: roster?.memberName ?? null,
    unitName: roster?.unitName ?? null,
    inRoster: roster !== null,
    accounts,
    lines: candidates
      .filter((line) => !recorded.has(line.id))
      .map((line) => ({
        id: line.id,
        postedAt: line.postedAt?.toISOString() ?? null,
        amount: line.amount,
        description: line.description,
        branch: line.branch,
        channel: line.channel,
        senderAccount: line.senderAccount,
      })),
  });
}
