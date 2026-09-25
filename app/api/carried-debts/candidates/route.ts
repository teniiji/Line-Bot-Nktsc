import { NextResponse } from "next/server";
import {
  findCandidates,
  findLineCandidates,
  planClearPayments,
  suggestedAmount,
} from "@/lib/carriedDebtCandidates";
import { loadCandidateInputs } from "@/lib/carriedDebtCandidatesStore";

export const dynamic = "force-dynamic";

// Every bank transfer that could be paying an open carried debt, read from
// the debt's side — see lib/carriedDebtCandidates.ts. Nothing is written
// here: a round's transfer is applied through that round's carry route, a
// daily line through ../[id]/from-line, and the clear ones in bulk through
// ./apply.
export async function GET() {
  const { debts, transfers, standings, lines, monthStandings } = await loadCandidateInputs();
  const outstandingOf = new Map(debts.map((d) => [d.id, d.outstanding]));
  const transferOf = new Map(transfers.map((t) => [t.id, t]));
  const lineOf = new Map(lines.map((l) => [l.id, l]));

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

  const lineCandidates = findLineCandidates(debts, lines, monthStandings).map((c) => {
    const l = lineOf.get(c.lineId)!;
    return {
      debtId: c.debtId,
      lineId: l.id,
      account: l.account,
      senderAccount: l.senderAccount,
      amount: l.amount,
      postedAt: l.postedAt,
      available: c.available,
      contested: c.contested,
      clear: c.clear,
      suggested: Math.round(Math.min(c.available, outstandingOf.get(c.debtId) ?? 0) * 100) / 100,
    };
  });

  const plan = planClearPayments(debts, transfers, standings, lines, monthStandings);

  return NextResponse.json({
    candidates,
    lineCandidates,
    plan,
    planTotal: Math.round(plan.reduce((sum, p) => sum + p.amount, 0) * 100) / 100,
  });
}
