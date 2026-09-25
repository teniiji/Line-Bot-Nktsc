import { NextResponse } from "next/server";
import { findCandidates, planClearPayments, suggestedAmount } from "@/lib/carriedDebtCandidates";
import { loadCandidateInputs } from "@/lib/carriedDebtCandidatesStore";

export const dynamic = "force-dynamic";

// Every statement transfer that could be paying an open carried debt, read
// from the debt's side — see lib/carriedDebtCandidates.ts. Nothing is written
// here; applying one goes through the round's own carry route, and applying
// the clear ones in bulk through ./apply.
export async function GET() {
  const { debts, transfers, standings, dailyOnly } = await loadCandidateInputs();
  const outstandingOf = new Map(debts.map((d) => [d.id, d.outstanding]));
  const transferOf = new Map(transfers.map((t) => [t.id, t]));

  const candidates = findCandidates(debts, transfers, standings).map((c) => {
    const t = transferOf.get(c.transferId)!;
    return {
      debtId: c.debtId,
      transferId: t.id,
      roundId: t.roundId,
      roundLabel: t.roundLabel,
      roundClosed: t.roundClosed,
      accountNumber: t.accountNumber,
      amount: t.amount,
      transferredAt: t.transferredAt,
      sourceFile: t.sourceFile,
      available: c.available,
      spare: c.spare,
      reason: c.reason,
      clear: c.clear,
      suggested: suggestedAmount(c, outstandingOf.get(c.debtId) ?? 0),
    };
  });

  const plan = planClearPayments(debts, transfers, standings);

  return NextResponse.json({
    candidates,
    dailyOnly,
    plan,
    planTotal: Math.round(plan.reduce((sum, p) => sum + p.amount, 0) * 100) / 100,
  });
}
