import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEDUCTION_CATEGORY } from "@/lib/statementSlipHints";
import { canBridgeToRound } from "@/lib/roundReach";
import { recomputeRoundPayments } from "@/lib/statementRecompute";
import { memberNumberKey } from "@/lib/memberNumber";
import { periodOfDate } from "@/lib/deductionPeriod";

export const dynamic = "force-dynamic";

// One-time catch-up for the gap app/api/statement-lines/[id]/record/route.ts
// closed going forward (see lib/roundReach.ts): a deduction payment recorded
// from the daily view before that fix shipped got filed as an Expense and
// nothing else, exactly like every one this route now finds. Safe to run
// more than once — a line already bridged, by this route or by the record
// route itself, carries the same fingerprint either way and is skipped.
//
// No new UI state to hold: this scans every Expense that could possibly be
// unbridged rather than a list staff would have to keep track of, and
// reports what it did.
//
// Each candidate is matched to the round whose MMYY code its own payment
// date falls in (periodOfDate) — never "whichever round is newest": a
// cooperative running a round a month has several open rounds side by side,
// and grabbing "newest" is exactly what turned an August recording into an
// overpayment on September's round the first time this shipped.
//
// At most one bridge per member per round per run, oldest recording first.
// The record route is safe writing more than one for the same member
// because it reads the member's status fresh from the database on every
// call — bridging one payment there is recomputed before the next request
// can see it. This route instead reads each round's members once and loops
// over every candidate against that one snapshot, so a member with two
// stale recordings landing on the same round would otherwise both look
// "still owing" and both get written. The oldest is kept as the one most
// likely to be the payment that was actually outstanding when it arrived;
// every later one for the same member and round is left alone.
export async function POST() {
  const candidates = await prisma.expense.findMany({
    where: {
      category: DEDUCTION_CATEGORY,
      statementLineId: { not: null },
      memberNumber: { not: null },
    },
    orderBy: { date: "asc" },
    select: { memberNumber: true, statementLineId: true },
  });

  if (candidates.length === 0) {
    return NextResponse.json({
      scanned: 0,
      bridged: 0,
      alreadyLinked: 0,
      notEligible: 0,
      skippedDuplicateMember: 0,
    });
  }

  const lines = await prisma.statementLine.findMany({
    where: { id: { in: candidates.map((c) => c.statementLineId as string) } },
    select: {
      id: true,
      fingerprint: true,
      senderAccount: true,
      amount: true,
      postedAt: true,
      account: true,
      branch: true,
      description: true,
      sourceFile: true,
    },
  });
  const lineById = new Map(lines.map((l) => [l.id, l]));

  // Whichever of these lines already made it into a round — bridged before
  // by this same route, or live by the record route — carries this exact
  // fingerprint already, and must not be written a second time.
  const existing = await prisma.statementTransfer.findMany({
    where: { fingerprint: { in: lines.map((l) => `line:${l.fingerprint}`) } },
    select: { fingerprint: true },
  });
  const alreadyLinked = new Set(existing.map((t) => t.fingerprint));

  // Every round the cooperative has ever created, keyed by its MMYY code —
  // few enough (one a month) that fetching them all up front is cheaper than
  // a lookup per candidate.
  const rounds = await prisma.statementRound.findMany({
    select: { id: true, period: true, label: true },
  });
  const roundByPeriod = new Map(rounds.map((r) => [r.period, r]));

  // Each round's members, fetched only for a round a candidate actually
  // named — a cooperative with years of rounds should not pay for the ones
  // nothing here points at.
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

  let bridged = 0;
  let alreadyLinkedCount = 0;
  let notEligible = 0;
  let skippedDuplicateMember = 0;
  const bridgedThisRun = new Set<string>();
  const touchedRounds = new Set<string>();

  for (const candidate of candidates) {
    const line = lineById.get(candidate.statementLineId as string);
    if (!line || !line.senderAccount || !line.postedAt) {
      notEligible += 1;
      continue;
    }

    const fingerprint = `line:${line.fingerprint}`;
    if (alreadyLinked.has(fingerprint)) {
      alreadyLinkedCount += 1;
      continue;
    }

    const round = roundByPeriod.get(periodOfDate(line.postedAt)) ?? null;
    if (!round) {
      notEligible += 1;
      continue;
    }

    const key = memberNumberKey(candidate.memberNumber as string);
    const dedupeKey = key ? `${round.id}|${key}` : null;
    if (dedupeKey && bridgedThisRun.has(dedupeKey)) {
      skippedDuplicateMember += 1;
      continue;
    }

    const onRound = await membersOf(round.id);
    const member = key ? onRound.find((m) => memberNumberKey(m.memberNumber) === key) ?? null : null;
    if (!canBridgeToRound(member)) {
      notEligible += 1;
      continue;
    }

    await prisma.statementTransfer.create({
      data: {
        roundId: round.id,
        memberNumber: member!.memberNumber,
        accountNumber: line.senderAccount,
        amount: line.amount,
        transferredAt: line.postedAt,
        account: line.account,
        branch: line.branch,
        description: line.description,
        fingerprint,
        sourceFile: line.sourceFile,
        manualMemberNumber: true,
      },
    });
    if (dedupeKey) bridgedThisRun.add(dedupeKey);
    touchedRounds.add(round.id);
    bridged += 1;
  }

  for (const roundId of touchedRounds) {
    await recomputeRoundPayments(roundId);
  }

  return NextResponse.json({
    scanned: candidates.length,
    bridged,
    alreadyLinked: alreadyLinkedCount,
    notEligible,
    skippedDuplicateMember,
  });
}
