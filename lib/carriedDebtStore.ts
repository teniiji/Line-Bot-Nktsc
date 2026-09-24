import { prisma } from "@/lib/prisma";
import { summarizeDebt } from "@/lib/carriedDebt";

// Database side of lib/carriedDebt.ts. Both figures below are rebuilt from
// the payment rows rather than adjusted in place, for the same reason
// recomputeRoundPayments rebuilds a round: incremental arithmetic is how
// totals drift away from the rows staff can click through to.

/** A carried debt's amountPaid / paidAt / status, from its payments. */
export async function recomputeCarriedDebt(debtId: string): Promise<void> {
  const debt = await prisma.carriedDebt.findUnique({
    where: { id: debtId },
    select: { amount: true },
  });
  if (!debt) return;
  const payments = await prisma.carriedDebtPayment.findMany({
    where: { debtId },
    select: { amount: true, paidAt: true },
  });
  const summary = summarizeDebt(debt.amount, payments);
  await prisma.carriedDebt.update({
    where: { id: debtId },
    data: summary,
  });
}

/**
 * How much of one statement line, in one round, has gone to carried debts —
 * written onto whichever transfer row carries that line right now. Looked up
 * by fingerprint because that is the line's identity across re-uploads; the
 * row's own id is not.
 */
export async function carriedByFingerprint(
  roundId: string,
  fingerprints: string[]
): Promise<Map<string, number>> {
  if (fingerprints.length === 0) return new Map();
  const grouped = await prisma.carriedDebtPayment.groupBy({
    by: ["fingerprint"],
    where: { roundId, fingerprint: { in: fingerprints } },
    _sum: { amount: true },
  });
  return new Map(
    grouped
      .filter((row) => row.fingerprint)
      .map((row) => [row.fingerprint as string, Math.round((row._sum.amount ?? 0) * 100) / 100])
  );
}

export async function syncTransferCarried(roundId: string, fingerprint: string): Promise<void> {
  const carried = (await carriedByFingerprint(roundId, [fingerprint])).get(fingerprint) ?? 0;
  await prisma.statementTransfer.updateMany({
    where: { roundId, fingerprint },
    data: { carriedAmount: carried },
  });
}
