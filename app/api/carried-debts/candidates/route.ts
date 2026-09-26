import { NextResponse } from "next/server";
import {
  findCandidates,
  findLineCandidates,
  planClearPayments,
  suggestedAmount,
} from "@/lib/carriedDebtCandidates";
import { loadCandidateInputs } from "@/lib/carriedDebtCandidatesStore";
import { memberNumberKey } from "@/lib/memberNumber";

export const dynamic = "force-dynamic";

// Every bank transfer that could be paying an open carried debt, read from
// the debt's side — see lib/carriedDebtCandidates.ts. Nothing is written
// here: a round's transfer is applied through that round's carry route, a
// daily line through ../[id]/from-line, and the clear ones in bulk through
// ./apply.
export async function GET() {
  const { debts, transfers, standings, lines, monthStandings, monthRounds, dismissedCount } =
    await loadCandidateInputs();
  const roundOfPeriod = new Map(monthRounds.map((r) => [r.period, r]));
  const onMonthRound = new Set(
    monthStandings.map((s) => `${s.period}|${memberNumberKey(s.memberNumber) ?? s.memberNumber}`)
  );
  const memberOfDebt = new Map(debts.map((d) => [d.id, memberNumberKey(d.memberNumber) ?? d.memberNumber]));
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
      looksMonthly: c.looksMonthly,
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
      description: l.description,
      amount: l.amount,
      postedAt: l.postedAt,
      available: c.available,
      contested: c.contested,
      bySlip: c.bySlip,
      looksMonthly: c.looksMonthly,
      // The open round of the month the money arrived in, when the member is
      // on it — where "นับเป็นยอดรอบ …" would put it.
      monthRound:
        c.period && onMonthRound.has(`${c.period}|${memberOfDebt.get(c.debtId)}`)
          ? { id: roundOfPeriod.get(c.period)?.id ?? null, label: roundOfPeriod.get(c.period)?.label ?? null }
          : null,
      clear: c.clear,
      suggested: Math.round(Math.min(c.available, outstandingOf.get(c.debtId) ?? 0) * 100) / 100,
      usedBy: l.usedBy,
    };
  });

  const plan = planClearPayments(debts, transfers, standings, lines, monthStandings);

  return NextResponse.json({
    candidates,
    lineCandidates,
    plan,
    dismissedCount,
    planTotal: Math.round(plan.reduce((sum, p) => sum + p.amount, 0) * 100) / 100,
  });
}
