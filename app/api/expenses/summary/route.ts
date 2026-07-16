import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildExpenseWhere } from "@/lib/expenseFilters";

type DateWhere = { gte?: Date; lte?: Date };

// The "this month" figure always reflects the current calendar month,
// intersected with whatever date range the user already filtered to (so it
// reads 0 if the filter excludes the current month entirely).
function thisMonthWhere(where: Record<string, unknown>): Record<string, unknown> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const existing = where.date as DateWhere | undefined;

  const gte = existing?.gte && existing.gte > monthStart ? existing.gte : monthStart;
  const exclusiveExistingEnd = existing?.lte
    ? new Date(existing.lte.getTime() + 1)
    : undefined;
  const lt =
    exclusiveExistingEnd && exclusiveExistingEnd < monthEnd
      ? exclusiveExistingEnd
      : monthEnd;

  return { ...where, date: { gte, lt } };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const where = buildExpenseWhere(searchParams);

  const [totalAgg, thisMonthAgg, categoryGroups, trendRows] = await Promise.all([
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
    prisma.expense.aggregate({
      where: thisMonthWhere(where),
      _sum: { amount: true },
    }),
    prisma.expense.groupBy({
      by: ["category"],
      where,
      _sum: { amount: true },
    }),
    // Prisma's groupBy can't truncate a date to month, so pull just the two
    // fields needed for that bucketing instead of full rows.
    prisma.expense.findMany({
      where,
      select: { date: true, amount: true },
    }),
  ]);

  const byCategory = categoryGroups
    .map((g) => ({ category: g.category, total: g._sum.amount ?? 0 }))
    .sort((a, b) => b.total - a.total);

  const byMonth = new Map<string, number>();
  for (const row of trendRows) {
    const key = `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, "0")}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + row.amount);
  }
  const monthlyTrend = Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ month, total }));

  return NextResponse.json({
    total: totalAgg._sum.amount ?? 0,
    thisMonth: thisMonthAgg._sum.amount ?? 0,
    topCategory: byCategory[0]?.category ?? null,
    byCategory,
    monthlyTrend,
  });
}
