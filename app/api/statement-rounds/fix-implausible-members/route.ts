import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isPlausibleMemberNumber } from "@/lib/memberNumber";
import { recomputeRoundPayments } from "@/lib/statementRecompute";

export const dynamic = "force-dynamic";

// One-time cleanup for a summary row imported as if it were a member — "รวม",
// "รวมทั้งสิ้น" and the like, landing in the memberNumber column of a
// รายการหัก sheet a round was seeded from. isPlausibleMemberNumber (lib/
// memberNumber.ts) has kept every sheet import from creating a new one of
// these since PR #186, but a round built before that fix keeps whatever it
// already imported — the guard only stops a new phantom member, it does not
// go back and remove one already sitting in a round's own list.
//
// Deletes rather than excludes: a phantom member is not a real person whose
// payment history is worth keeping around under an excludedReason, and
// nothing legitimate ever matches "รวม" as an account holder — the row
// carries no account number and, in every case seen, no transfers either.
export async function POST() {
  const candidates = await prisma.statementMember.findMany({
    where: {},
    select: { id: true, roundId: true, memberNumber: true },
  });

  const implausible = candidates.filter((m) => !isPlausibleMemberNumber(m.memberNumber));
  if (implausible.length === 0) {
    return NextResponse.json({ scanned: candidates.length, removed: 0 });
  }

  await prisma.statementMember.deleteMany({
    where: { id: { in: implausible.map((m) => m.id) } },
  });

  const touchedRounds = new Set(implausible.map((m) => m.roundId));
  for (const roundId of touchedRounds) {
    await recomputeRoundPayments(roundId);
  }

  return NextResponse.json({
    scanned: candidates.length,
    removed: implausible.length,
    removedNumbers: implausible.map((m) => m.memberNumber),
  });
}
