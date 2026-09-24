import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEDUCTION_CATEGORY } from "@/lib/statementSlipHints";
import { canBridgeToRound } from "@/lib/roundReach";
import { recomputeRoundPayments } from "@/lib/statementRecompute";
import { memberNumberKey } from "@/lib/memberNumber";

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
export async function POST() {
  const candidates = await prisma.expense.findMany({
    where: {
      category: DEDUCTION_CATEGORY,
      statementLineId: { not: null },
      memberNumber: { not: null },
    },
    select: { memberNumber: true, statementLineId: true },
  });

  if (candidates.length === 0) {
    return NextResponse.json({ scanned: 0, bridged: 0, alreadyLinked: 0, notEligible: 0 });
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

  const latestRound = await prisma.statementRound.findFirst({
    orderBy: { period: "desc" },
    select: { id: true, period: true, label: true },
  });
  const onRound = latestRound
    ? await prisma.statementMember.findMany({
        where: { roundId: latestRound.id },
        select: { memberNumber: true, deductionResult: true, status: true },
      })
    : [];

  let bridged = 0;
  let alreadyLinkedCount = 0;
  let notEligible = 0;

  for (const candidate of candidates) {
    const line = lineById.get(candidate.statementLineId as string);
    if (!latestRound || !line || !line.senderAccount) {
      notEligible += 1;
      continue;
    }

    const fingerprint = `line:${line.fingerprint}`;
    if (alreadyLinked.has(fingerprint)) {
      alreadyLinkedCount += 1;
      continue;
    }

    const key = memberNumberKey(candidate.memberNumber as string);
    const member = key ? onRound.find((m) => memberNumberKey(m.memberNumber) === key) ?? null : null;
    if (!canBridgeToRound(member)) {
      notEligible += 1;
      continue;
    }

    await prisma.statementTransfer.create({
      data: {
        roundId: latestRound.id,
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
    bridged += 1;
  }

  if (bridged > 0 && latestRound) {
    await recomputeRoundPayments(latestRound.id);
  }

  return NextResponse.json({
    scanned: candidates.length,
    bridged,
    alreadyLinked: alreadyLinkedCount,
    notEligible,
  });
}
