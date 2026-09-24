import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canBridgeToRound, coveredByRealTransfer } from "@/lib/roundReach";
import { recomputeRoundPayments } from "@/lib/statementRecompute";
import { memberNumberKey } from "@/lib/memberNumber";
import { periodOfDate } from "@/lib/deductionPeriod";

export const dynamic = "force-dynamic";

// One-time repair for every transfer app/api/statement-lines/[id]/record/route.ts
// and app/api/statement-lines/backfill-bridge/route.ts wrote before both
// routes checked what this one now also checks. Two separate mistakes,
// both caught here:
//
//   * wrong round — a bridged payment placed by "whichever round is newest"
//     instead of the round its own date falls in (periodOfDate), so an
//     August recording ended up counted as a September payment.
//   * duplicate of a real transfer — a bridged payment for the same bank
//     line the round's own Statement upload already carries, because
//     canBridgeToRound only asks whether the member still owes anything,
//     which a second unrelated bank line answers exactly the same way as
//     the round's own upload already having counted this one.
//
// Scoped by construction to exactly the rows either bug could have written:
// manualMemberNumber transfers whose fingerprint carries the "line:" prefix
// both routes use for a bridged payment. A split's own manualMemberNumber
// rows and a cash payment's "cash:" rows are untouched — neither is ever
// misplaced by round or duplicated by a file upload, because neither is
// chosen by "newest round" or read off a bank line at all.
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
      accountNumber: true,
      amount: true,
      transferredAt: true,
    },
  });

  if (candidates.length === 0) {
    return NextResponse.json({
      scanned: 0,
      alreadyCorrect: 0,
      moved: 0,
      removedDuplicate: 0,
      removedUnplaceable: 0,
    });
  }

  const rounds = await prisma.statementRound.findMany({
    select: { id: true, period: true, label: true, closedAt: true },
  });
  // A closed round is frozen: nothing sitting in one is touched, and nothing
  // is moved into one — money for a closed month belongs on the
  // ชำระข้ามเดือน tab, placed by a person.
  const closedRoundIds = new Set(rounds.filter((r) => r.closedAt).map((r) => r.id));
  const roundByPeriod = new Map(rounds.filter((r) => !r.closedAt).map((r) => [r.period, r]));

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

  // Real transfers a round already holds for one account+amount — fetched
  // per (round, account, amount) as candidates need it rather than up
  // front, since most rounds and most account/amount pairs are never asked
  // about.
  const realTransfersOf = async (roundId: string, accountNumber: string, amount: number) =>
    prisma.statementTransfer.findMany({
      where: { roundId, accountNumber, amount, manualMemberNumber: false },
      select: { accountNumber: true, amount: true, transferredAt: true },
    });

  let alreadyCorrect = 0;
  let moved = 0;
  let removedDuplicate = 0;
  let removedUnplaceable = 0;
  const touchedRounds = new Set<string>();

  for (const candidate of candidates) {
    if (closedRoundIds.has(candidate.roundId)) {
      alreadyCorrect += 1;
      continue;
    }
    if (!candidate.transferredAt) {
      // No date to judge it by — leave it where it is rather than guessing.
      alreadyCorrect += 1;
      continue;
    }

    // Checked first, in whichever round the row is sitting in right now: a
    // bridged payment the round's own statement already carries as a real
    // transfer is the same money counted twice, whether or not the round
    // it landed in also happens to be the right month.
    const currentReal = await realTransfersOf(candidate.roundId, candidate.accountNumber, candidate.amount);
    if (coveredByRealTransfer(currentReal, candidate.accountNumber, candidate.amount, candidate.transferredAt)) {
      await prisma.statementTransfer.delete({ where: { id: candidate.id } });
      touchedRounds.add(candidate.roundId);
      removedDuplicate += 1;
      continue;
    }

    const correctRound = roundByPeriod.get(periodOfDate(candidate.transferredAt)) ?? null;
    if (correctRound && correctRound.id === candidate.roundId) {
      alreadyCorrect += 1;
      continue;
    }

    const key = memberNumberKey(candidate.memberNumber ?? "");
    const member =
      correctRound && key
        ? (await membersOf(correctRound.id)).find((m) => memberNumberKey(m.memberNumber) === key) ?? null
        : null;

    // Moving it would only recreate the same duplicate one round over, so
    // the correct round's own real transfers are checked before committing
    // to a move.
    const targetReal =
      correctRound && canBridgeToRound(member)
        ? await realTransfersOf(correctRound.id, candidate.accountNumber, candidate.amount)
        : null;
    const targetIsDuplicate =
      targetReal !== null &&
      coveredByRealTransfer(targetReal, candidate.accountNumber, candidate.amount, candidate.transferredAt);

    if (correctRound && canBridgeToRound(member) && !targetIsDuplicate) {
      await prisma.statementTransfer.update({
        where: { id: candidate.id },
        data: { roundId: correctRound.id },
      });
      touchedRounds.add(candidate.roundId);
      touchedRounds.add(correctRound.id);
      moved += 1;
    } else if (targetIsDuplicate) {
      await prisma.statementTransfer.delete({ where: { id: candidate.id } });
      touchedRounds.add(candidate.roundId);
      removedDuplicate += 1;
    } else {
      // Nowhere right to put it (no round covers that month) or the member
      // it would land on there is not one the round still shows as owing
      // (already settled some other way, or not even on that round's list)
      // — either way it does not belong in the round it is sitting in now,
      // and guessing a different one it does belong in is exactly the
      // mistake being undone here. Removing it reverts the underlying
      // Expense to the plain, unbridged state it was in before either
      // route touched it; staff can place it correctly by hand the same
      // way as any other daily-view recording lib/roundReach.ts warns
      // about.
      await prisma.statementTransfer.delete({ where: { id: candidate.id } });
      touchedRounds.add(candidate.roundId);
      removedUnplaceable += 1;
    }
  }

  for (const roundId of touchedRounds) {
    await recomputeRoundPayments(roundId);
  }

  return NextResponse.json({
    scanned: candidates.length,
    alreadyCorrect,
    moved,
    removedDuplicate,
    removedUnplaceable,
  });
}
