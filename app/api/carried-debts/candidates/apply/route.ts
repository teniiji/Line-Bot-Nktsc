import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LINE_FINGERPRINT_PREFIX } from "@/lib/carriedDebt";
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
    (Array.isArray(body.items) ? body.items : []).map(
      (item: { debtId?: unknown; source?: unknown }) => `${item?.debtId}|${item?.source}`
    )
  );
  if (confirmed.size === 0) {
    return NextResponse.json({ error: "ไม่มีรายการที่ยืนยัน" }, { status: 400 });
  }

  const { debts, transfers, standings, lines, monthStandings } = await loadCandidateInputs();
  const plan = planClearPayments(debts, transfers, standings, lines, monthStandings).filter((p) =>
    confirmed.has(`${p.debtId}|${p.source}`)
  );
  if (plan.length === 0) {
    return NextResponse.json({ applied: 0, debts: 0, amount: 0 });
  }

  const transferOf = new Map(transfers.map((t) => [t.id, t]));
  const transferRows = await prisma.statementTransfer.findMany({
    where: {
      id: {
        in: plan.filter((p) => p.source.startsWith("t:")).map((p) => p.source.slice(2)),
      },
    },
    select: { id: true, fingerprint: true },
  });
  const fingerprintOf = new Map(transferRows.map((r) => [r.id, r.fingerprint]));
  const lineRows = await prisma.statementLine.findMany({
    where: {
      id: { in: plan.filter((p) => p.source.startsWith("l:")).map((p) => p.source.slice(2)) },
    },
    select: { id: true, fingerprint: true, senderAccount: true, postedAt: true },
  });
  const lineOf = new Map(lineRows.map((l) => [l.id, l]));

  const data = [];
  const synced: { roundId: string; fingerprint: string; closed: boolean }[] = [];
  for (const p of plan) {
    const id = p.source.slice(2);
    if (p.source.startsWith("t:")) {
      const t = transferOf.get(id);
      const fingerprint = fingerprintOf.get(id);
      if (!t || !fingerprint) continue;
      data.push({
        debtId: p.debtId,
        amount: p.amount,
        paidAt: t.transferredAt ?? new Date(),
        method: "transfer",
        roundId: t.roundId,
        fingerprint,
        accountNumber: t.accountNumber,
        note: "จับคู่จาก Statement",
      });
      synced.push({ roundId: t.roundId, fingerprint, closed: t.roundClosed });
    } else {
      const line = lineOf.get(id);
      if (!line) continue;
      data.push({
        debtId: p.debtId,
        amount: p.amount,
        paidAt: line.postedAt ?? new Date(),
        method: "transfer",
        roundId: null,
        fingerprint: `${LINE_FINGERPRINT_PREFIX}${line.fingerprint}`,
        accountNumber: line.senderAccount,
        note: null,
      });
    }
  }
  await prisma.carriedDebtPayment.createMany({ data });

  for (const s of synced) await syncTransferCarried(s.roundId, s.fingerprint);
  const openRounds = new Set(synced.filter((s) => !s.closed).map((s) => s.roundId));
  for (const roundId of openRounds) await recomputeRoundPayments(roundId);
  const touchedDebts = new Set(data.map((d) => d.debtId));
  for (const debtId of touchedDebts) await recomputeCarriedDebt(debtId);

  return NextResponse.json({
    applied: data.length,
    debts: touchedDebts.size,
    amount: Math.round(data.reduce((sum, d) => sum + d.amount, 0) * 100) / 100,
  });
}
