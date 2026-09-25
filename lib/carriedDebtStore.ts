import { prisma } from "@/lib/prisma";
import { LINE_FINGERPRINT_PREFIX, summarizeDebt } from "@/lib/carriedDebt";
import { coveredByRealTransfer } from "@/lib/roundReach";

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

/**
 * Hands payments that were taken from a daily bank line (no round held it at
 * the time) over to the round row that now carries the same line, so the
 * round leaves that money out instead of counting it a second time.
 *
 * A line reaches a round two ways — a statement upload reading the same bank
 * line, or the daily page bridging it (fingerprint "line:…") — and both are
 * recognised: the bridged row by its fingerprint, the uploaded one by account,
 * amount and day, the rule coveredByRealTransfer already uses for the same
 * question. Call it after writing a round's transfers and before recomputing
 * the round. Returns how many payments moved.
 */
export async function adoptLinePayments(roundId: string): Promise<number> {
  const pending = await prisma.carriedDebtPayment.findMany({
    where: { roundId: null, fingerprint: { startsWith: LINE_FINGERPRINT_PREFIX } },
    select: { id: true, fingerprint: true },
  });
  if (pending.length === 0) return 0;

  const lines = await prisma.statementLine.findMany({
    where: {
      fingerprint: {
        in: [...new Set(pending.map((p) => (p.fingerprint as string).slice(LINE_FINGERPRINT_PREFIX.length)))],
      },
    },
    select: { fingerprint: true, senderAccount: true, amount: true, postedAt: true },
  });
  const lineOf = new Map(lines.map((l) => [`${LINE_FINGERPRINT_PREFIX}${l.fingerprint}`, l]));
  const accounts = [...new Set(lines.map((l) => l.senderAccount).filter(Boolean))] as string[];
  const rows = await prisma.statementTransfer.findMany({
    where: {
      roundId,
      OR: [
        { fingerprint: { in: [...lineOf.keys()] } },
        ...(accounts.length ? [{ accountNumber: { in: accounts } }] : []),
      ],
    },
    select: { fingerprint: true, accountNumber: true, amount: true, transferredAt: true },
  });
  if (rows.length === 0) return 0;

  // One round row stands for one bank line: two identical lines on the same
  // day must land on two rows, not both on the first.
  const taken = new Map<string, string>();
  const moved = new Set<string>();
  let count = 0;
  for (const payment of pending) {
    const lineKey = payment.fingerprint as string;
    const line = lineOf.get(lineKey);
    if (!line) continue;
    const row =
      rows.find((r) => r.fingerprint === lineKey) ??
      rows.find(
        (r) =>
          (!taken.has(r.fingerprint) || taken.get(r.fingerprint) === lineKey) &&
          line.senderAccount !== null &&
          line.postedAt !== null &&
          coveredByRealTransfer([r], line.senderAccount, line.amount, line.postedAt)
      );
    if (!row) continue;
    taken.set(row.fingerprint, lineKey);
    await prisma.carriedDebtPayment.update({
      where: { id: payment.id },
      data: { roundId, fingerprint: row.fingerprint },
    });
    moved.add(row.fingerprint);
    count += 1;
  }
  for (const fingerprint of moved) await syncTransferCarried(roundId, fingerprint);
  return count;
}

export async function syncTransferCarried(roundId: string, fingerprint: string): Promise<void> {
  const carried = (await carriedByFingerprint(roundId, [fingerprint])).get(fingerprint) ?? 0;
  await prisma.statementTransfer.updateMany({
    where: { roundId, fingerprint },
    data: { carriedAmount: carried },
  });
}
