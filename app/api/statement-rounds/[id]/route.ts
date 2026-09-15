import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { matchSlipHints } from "@/lib/statementSlipHints";
import { countedElsewhere } from "@/lib/roundDoubleCount";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const round = await prisma.statementRound.findUnique({ where: { id: params.id } });
  if (!round) {
    return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });
  }

  const [members, transfers] = await Promise.all([
    prisma.statementMember.findMany({
      where: { roundId: round.id },
      orderBy: [{ unitName: "asc" }, { memberNumber: "asc" }],
    }),
    // Every transfer, not just the unmatched ones: staff need to reach an
    // individual payment to say "this was ซื้อหุ้น, not a deduction", and the
    // dangerous case is precisely one that did match a member.
    prisma.statementTransfer.findMany({
      where: { roundId: round.id },
      orderBy: { transferredAt: "desc" },
    }),
  ]);

  const unmatched = transfers.filter((t) => !t.memberNumber && !t.excludedReason);

  // Still-owing first, then overpaid, then settled: a round runs to hundreds
  // of members and the ones staff opened this tab to chase should not be
  // below a screenful of people who already paid. Sorted here rather than in
  // the query because the ordering is by meaning, not alphabetical — "unpaid"
  // sorts last as a string.
  const STATUS_ORDER: Record<string, number> = { unpaid: 0, overpaid: 1, paid: 2 };
  members.sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 0) - (STATUS_ORDER[b.status] ?? 0)
  );

  const totals = members.reduce(
    (acc, m) => {
      acc.due += m.amountDue;
      acc.paid += m.amountPaid;
      return acc;
    },
    { due: 0, paid: 0 }
  );

  // Which statements this round was built from. Uploads accumulate, so
  // without this the only sign a file had been loaded was the totals moving,
  // and staff had no way to tell whether they had already dropped in the
  // second half of the month.
  const loaded = await prisma.statementTransfer.groupBy({
    by: ["account", "branch", "sourceFile"],
    where: { roundId: round.id },
    _count: { _all: true },
    _sum: { amount: true },
  });

  // Which of these transfers look like they were for something other than a
  // deduction, judged against the slips members filed through the bot.
  const memberNumbers = [...new Set(transfers.map((t) => t.memberNumber).filter(Boolean))] as string[];
  const slips =
    memberNumbers.length > 0
      ? await prisma.expense.findMany({
          where: { memberNumber: { in: memberNumbers } },
          select: { memberNumber: true, amount: true, date: true, category: true },
        })
      : [];
  const hints = matchSlipHints(
    transfers.map((t) => ({
      id: t.id,
      memberNumber: t.memberNumber,
      amount: t.amount,
      transferredAt: t.transferredAt,
    })),
    slips.map((s) => ({
      memberNumber: s.memberNumber as string,
      amount: s.amount,
      date: s.date,
      category: s.category,
    }))
  );

  // The same bank line counting in another round as well. Loading one export
  // into two rounds is the obvious thing to do — September's file into August
  // for the late payers and into September for the current month — and it
  // marks everyone who paid once as having settled both. See
  // lib/roundDoubleCount.ts.
  const counts = (t: { memberNumber: string | null; excludedReason: string | null }) =>
    t.memberNumber !== null && t.excludedReason === null;
  const twins = await prisma.statementTransfer.findMany({
    where: {
      fingerprint: { in: transfers.map((t) => t.fingerprint) },
      roundId: { not: round.id },
    },
    select: { fingerprint: true, roundId: true, memberNumber: true, excludedReason: true },
  });
  const otherRounds = twins.length
    ? await prisma.statementRound.findMany({
        where: { id: { in: [...new Set(twins.map((t) => t.roundId))] } },
        select: { id: true, label: true },
      })
    : [];
  const labelByRound = new Map(otherRounds.map((r) => [r.id, r.label]));
  const doubles = countedElsewhere(
    transfers.map((t) => ({ id: t.id, fingerprint: t.fingerprint, counts: counts(t) })),
    twins.map((t) => ({
      fingerprint: t.fingerprint,
      label: labelByRound.get(t.roundId) ?? t.roundId,
      counts: counts(t),
    }))
  );

  const withHints = transfers.map((t) => ({
    id: t.id,
    memberNumber: t.memberNumber,
    accountNumber: t.accountNumber,
    amount: t.amount,
    transferredAt: t.transferredAt,
    branch: t.branch,
    description: t.description,
    excludedReason: t.excludedReason,
    slipHint: hints.get(t.id) ?? null,
    // Empty on all but the few lines being counted more than once.
    alsoCountedIn: doubles.get(t.id) ?? [],
  }));

  const excluded = withHints.filter((t) => t.excludedReason);

  return NextResponse.json({
    round,
    data: members,
    unmatched,
    transfers: withHints,
    excluded,
    excludedTotal:
      Math.round(excluded.reduce((sum, t) => sum + t.amount, 0) * 100) / 100,
    statements: loaded
      .map((row) => ({
        account: row.account,
        branch: row.branch,
        sourceFile: row.sourceFile,
        transfers: row._count._all,
        amount: Math.round((row._sum.amount ?? 0) * 100) / 100,
      }))
      .sort(
        (a, b) =>
          a.account.localeCompare(b.account) ||
          (a.sourceFile ?? "").localeCompare(b.sourceFile ?? "", "th")
      ),
    totals: {
      ...totals,
      outstanding: Math.round((totals.due - totals.paid) * 100) / 100,
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  // The member and transfer rows are this round's working data, not history
  // worth keeping on its own — both are rebuilt by re-uploading the two
  // sheets, so they go with the round rather than being orphaned.
  await prisma.$transaction([
    prisma.statementMember.deleteMany({ where: { roundId: params.id } }),
    prisma.statementTransfer.deleteMany({ where: { roundId: params.id } }),
    prisma.statementRound.deleteMany({ where: { id: params.id } }),
  ]);

  return NextResponse.json({ ok: true });
}
