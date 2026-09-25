import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { planClearPayments } from "@/lib/carriedDebtCandidates";
import { loadCandidateInputs } from "@/lib/carriedDebtCandidatesStore";
import { recomputeCarriedDebt, syncTransferCarried } from "@/lib/carriedDebtStore";
import { recomputeRoundPayments } from "@/lib/statementRecompute";

export const dynamic = "force-dynamic";

// Applies the clear candidates staff confirmed — the ones nobody needs to
// choose between (lib/carriedDebtCandidates.ts). The plan is worked out again
// here rather than taken from the request, so an amount the page showed a
// minute ago is never written after something else has changed it; only the
// pairs staff saw and confirmed are applied, at today's figures.
//
// Each round is recomputed once at the end rather than per payment: a round
// holds thousands of members, and doing it a hundred times over would not
// finish inside a request.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const confirmed = new Set(
    (Array.isArray(body.items) ? body.items : [])
      .map((item: { debtId?: unknown; transferId?: unknown }) => `${item?.debtId}|${item?.transferId}`)
  );
  if (confirmed.size === 0) {
    return NextResponse.json({ error: "ไม่มีรายการที่ยืนยัน" }, { status: 400 });
  }

  const { debts, transfers, standings } = await loadCandidateInputs();
  const plan = planClearPayments(debts, transfers, standings).filter((p) =>
    confirmed.has(`${p.debtId}|${p.transferId}`)
  );
  if (plan.length === 0) {
    return NextResponse.json({ applied: 0, amount: 0 });
  }

  const transferOf = new Map(transfers.map((t) => [t.id, t]));
  const rows = await prisma.statementTransfer.findMany({
    where: { id: { in: [...new Set(plan.map((p) => p.transferId))] } },
    select: { id: true, fingerprint: true },
  });
  const fingerprintOf = new Map(rows.map((r) => [r.id, r.fingerprint]));

  const written = plan.filter((p) => fingerprintOf.has(p.transferId));
  await prisma.carriedDebtPayment.createMany({
    data: written.map((p) => {
      const t = transferOf.get(p.transferId)!;
      return {
        debtId: p.debtId,
        amount: p.amount,
        paidAt: t.transferredAt ?? new Date(),
        method: "transfer",
        roundId: t.roundId,
        fingerprint: fingerprintOf.get(p.transferId) as string,
        accountNumber: t.accountNumber,
        note: "จับคู่จาก Statement",
      };
    }),
  });

  for (const p of written) {
    await syncTransferCarried(transferOf.get(p.transferId)!.roundId, fingerprintOf.get(p.transferId)!);
  }
  const openRounds = new Set(
    written.map((p) => transferOf.get(p.transferId)!).filter((t) => !t.roundClosed).map((t) => t.roundId)
  );
  for (const roundId of openRounds) await recomputeRoundPayments(roundId);
  for (const debtId of new Set(written.map((p) => p.debtId))) await recomputeCarriedDebt(debtId);

  return NextResponse.json({
    applied: written.length,
    debts: new Set(written.map((p) => p.debtId)).size,
    amount: Math.round(written.reduce((sum, p) => sum + p.amount, 0) * 100) / 100,
  });
}
