import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LINE_FINGERPRINT_PREFIX, countedAmount } from "@/lib/carriedDebt";
import { isMemberDeposit } from "@/lib/statementLines";
import { coveredByRealTransfer } from "@/lib/roundReach";
import { parseDebtPaymentQuery, sortSources, type DebtPaymentSource } from "@/lib/debtPaymentSearch";

export const dynamic = "force-dynamic";

const LIMIT = 40;

// Any bank money that could pay this carried debt, found by amount or by the
// account it came from — not only the debtor's own accounts. See
// lib/debtPaymentSearch.ts. ?q=18000 or ?q=4301008047
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const debt = await prisma.carriedDebt.findUnique({ where: { id: params.id } });
  if (!debt) return NextResponse.json({ error: "ไม่พบหนี้รายการนี้" }, { status: 404 });
  const query = parseDebtPaymentQuery(request.nextUrl.searchParams.get("q") ?? "");
  if (!query) {
    return NextResponse.json(
      { error: "ใส่ยอดเงิน (เช่น 18000) หรือเลขบัญชีที่โอนมา (6 หลักขึ้นไป)" },
      { status: 400 }
    );
  }

  // Money in rounds still open: a closed round's transfers are frozen.
  const openRounds = await prisma.statementRound.findMany({
    where: { closedAt: null },
    select: { id: true, label: true },
  });
  const labelOf = new Map(openRounds.map((r) => [r.id, r.label]));
  const transfers = await prisma.statementTransfer.findMany({
    where: {
      roundId: { in: openRounds.map((r) => r.id) },
      excludedReason: null,
      ...("amount" in query ? { amount: query.amount } : { accountNumber: query.account }),
    },
    orderBy: { transferredAt: "desc" },
    take: LIMIT,
  });

  // Daily lines no round holds yet.
  const lines = await prisma.statementLine.findMany({
    where: "amount" in query ? { amount: query.amount } : { senderAccount: query.account },
    orderBy: { postedAt: "desc" },
    take: LIMIT,
  });
  const deposits = lines.filter((l) => isMemberDeposit(l.channel));
  const lineKeys = deposits.map((l) => `${LINE_FINGERPRINT_PREFIX}${l.fingerprint}`);
  const [held, realRows, used] = deposits.length
    ? await Promise.all([
        prisma.statementTransfer.findMany({
          where: { fingerprint: { in: lineKeys } },
          select: { fingerprint: true },
        }),
        prisma.statementTransfer.findMany({
          where: {
            manualMemberNumber: false,
            accountNumber: { in: [...new Set(deposits.map((l) => l.senderAccount).filter(Boolean))] as string[] },
          },
          select: { accountNumber: true, amount: true, transferredAt: true },
        }),
        prisma.carriedDebtPayment.groupBy({
          by: ["fingerprint"],
          where: { roundId: null, fingerprint: { in: lineKeys } },
          _sum: { amount: true },
        }),
      ])
    : [[], [], []];
  const heldKeys = new Set(held.map((t) => t.fingerprint));
  const usedOf = new Map(used.map((u) => [u.fingerprint, u._sum.amount ?? 0]));
  const freeLines = deposits.filter(
    (l) =>
      !heldKeys.has(`${LINE_FINGERPRINT_PREFIX}${l.fingerprint}`) &&
      !(l.senderAccount && l.postedAt && coveredByRealTransfer(realRows, l.senderAccount, l.amount, l.postedAt))
  );

  // Names for whoever the money counts for now.
  const numbers = [...new Set(transfers.map((t) => t.memberNumber).filter(Boolean))] as string[];
  const roster = numbers.length
    ? await prisma.memberRoster.findMany({
        where: { memberNumber: { in: numbers } },
        select: { memberNumber: true, memberName: true },
      })
    : [];
  const nameOf = new Map(roster.map((r) => [r.memberNumber, r.memberName]));
  const recordedFor = freeLines.length
    ? await prisma.expense.findMany({
        where: { statementLineId: { in: freeLines.map((l) => l.id) } },
        select: { statementLineId: true, memberNumber: true, memberFullName: true },
      })
    : [];
  const recordingOf = new Map(recordedFor.map((e) => [e.statementLineId, e]));

  const sources: DebtPaymentSource[] = [
    ...transfers.map((t) => ({
      kind: "transfer" as const,
      id: t.id,
      roundId: t.roundId,
      roundLabel: labelOf.get(t.roundId) ?? null,
      memberNumber: t.memberNumber,
      memberName: t.memberNumber ? (nameOf.get(t.memberNumber) ?? null) : null,
      accountNumber: t.accountNumber || null,
      description: t.description,
      amount: t.amount,
      date: t.transferredAt?.toISOString() ?? null,
      available: countedAmount(t),
    })),
    ...freeLines.map((l) => {
      const rec = recordingOf.get(l.id);
      return {
        kind: "line" as const,
        id: l.id,
        roundId: null,
        roundLabel: null,
        memberNumber: rec?.memberNumber ?? null,
        memberName: rec?.memberFullName ?? null,
        accountNumber: l.senderAccount,
        description: l.description,
        amount: l.amount,
        date: l.postedAt?.toISOString() ?? null,
        available: Math.round((l.amount - (usedOf.get(`${LINE_FINGERPRINT_PREFIX}${l.fingerprint}`) ?? 0)) * 100) / 100,
      };
    }),
  ];
  return NextResponse.json({ data: sortSources(sources) });
}
