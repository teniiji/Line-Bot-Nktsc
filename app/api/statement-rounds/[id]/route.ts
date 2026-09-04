import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const round = await prisma.statementRound.findUnique({ where: { id: params.id } });
  if (!round) {
    return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });
  }

  const [members, unmatched] = await Promise.all([
    prisma.statementMember.findMany({
      where: { roundId: round.id },
      orderBy: [{ unitName: "asc" }, { memberNumber: "asc" }],
    }),
    prisma.statementTransfer.findMany({
      where: { roundId: round.id, memberNumber: null },
      orderBy: { transferredAt: "desc" },
    }),
  ]);

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

  return NextResponse.json({
    round,
    data: members,
    unmatched,
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
