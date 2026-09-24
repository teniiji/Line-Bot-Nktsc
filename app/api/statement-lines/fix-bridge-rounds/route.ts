import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canBridgeToRound } from "@/lib/roundReach";
import { recomputeRoundPayments } from "@/lib/statementRecompute";
import { memberNumberKey } from "@/lib/memberNumber";
import { periodOfDate } from "@/lib/deductionPeriod";

export const dynamic = "force-dynamic";

// One-time repair for every transfer app/api/statement-lines/[id]/record/route.ts
// and app/api/statement-lines/backfill-bridge/route.ts wrote before both were
// fixed to place a bridged payment by the round its own date falls in rather
// than by "whichever round is newest" — see periodOfDate in
// lib/deductionPeriod.ts and the comments on those two routes for how an
// August recording ended up counted as a September payment.
//
// Scoped by construction to exactly the rows that bug could have written:
// manualMemberNumber transfers whose fingerprint carries the "line:" prefix
// both routes use for a bridged payment. A split's own manualMemberNumber
// rows and a cash payment's "cash:" rows are untouched — neither is ever
// misplaced by round, because neither is chosen by "newest round" at all.
//
// Not an upload problem, so there is nothing here for staff to delete a
// Statement file over: every real uploaded transfer already sits in the
// round its own file was uploaded into and is left exactly alone.
export async function POST() {
  const candidates = await prisma.statementTransfer.findMany({
    where: { manualMemberNumber: true, fingerprint: { startsWith: "line:" } },
    select: {
      id: true,
      roundId: true,
      memberNumber: true,
      transferredAt: true,
    },
  });

  if (candidates.length === 0) {
    return NextResponse.json({ scanned: 0, alreadyCorrect: 0, moved: 0, removed: 0 });
  }

  const rounds = await prisma.statementRound.findMany({
    select: { id: true, period: true, label: true },
  });
  const roundByPeriod = new Map(rounds.map((r) => [r.period, r]));

  const membersByRound = new Map<
    string,
    { memberNumber: string; deductionResult: string; status: string }[]
  >();
  const membersOf = async (roundId: string) => {
    const cached = membersByRound.get(roundId);
    if (cached) return cached;
    const rows = await prisma.statementMember.findMany({
      where: { roundId },
      select: { memberNumber: true, deductionResult: true, status: true },
    });
    membersByRound.set(roundId, rows);
    return rows;
  };

  let alreadyCorrect = 0;
  let moved = 0;
  let removed = 0;
  const touchedRounds = new Set<string>();

  for (const candidate of candidates) {
    if (!candidate.transferredAt) {
      // No date to judge it by — leave it where it is rather than guessing.
      alreadyCorrect += 1;
      continue;
    }

    const correctRound = roundByPeriod.get(periodOfDate(candidate.transferredAt)) ?? null;
    if (correctRound && correctRound.id === candidate.roundId) {
      alreadyCorrect += 1;
      continue;
    }

    // Nowhere right to put it (no round covers that month) or the member it
    // would land on there is not one the round still shows as owing (already
    // settled some other way, or not even on that round's list) — either way
    // it does not belong in the round it is sitting in now, and guessing a
    // different one it does belong in is exactly the mistake being undone
    // here. Removing it reverts the underlying Expense to the plain,
    // unbridged state it was in before either route touched it; staff can
    // place it correctly by hand the same way as any other daily-view
    // recording lib/roundReach.ts warns about.
    const key = memberNumberKey(candidate.memberNumber ?? "");
    const member =
      correctRound && key
        ? (await membersOf(correctRound.id)).find((m) => memberNumberKey(m.memberNumber) === key) ?? null
        : null;

    if (correctRound && canBridgeToRound(member)) {
      await prisma.statementTransfer.update({
        where: { id: candidate.id },
        data: { roundId: correctRound.id },
      });
      touchedRounds.add(candidate.roundId);
      touchedRounds.add(correctRound.id);
      moved += 1;
    } else {
      await prisma.statementTransfer.delete({ where: { id: candidate.id } });
      touchedRounds.add(candidate.roundId);
      removed += 1;
    }
  }

  for (const roundId of touchedRounds) {
    await recomputeRoundPayments(roundId);
  }

  return NextResponse.json({
    scanned: candidates.length,
    alreadyCorrect,
    moved,
    removed,
  });
}
