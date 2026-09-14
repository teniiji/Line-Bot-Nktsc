import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildExpenseWhere } from "@/lib/expenseFilters";
import { cooperativeToday, monthWindow } from "@/lib/cooperativeClock";

// buildExpenseWhere's own shape: a half-open window, because a day is a day
// and not the instant it begins (see lib/expenseFilters.ts).
type DateWhere = { gte?: Date; lt?: Date };

// The "this month" figure always reflects the current calendar month,
// intersected with whatever date range the user already filtered to (so it
// reads 0 if the filter excludes the current month entirely).
//
// The month is the cooperative's, not the server's: Vercel runs in UTC, so a
// month built from the server's own clock starts and ends seven hours away
// from the month the office is actually in. See lib/cooperativeClock.ts.
function thisMonthWhere(
  where: Record<string, unknown>,
  now: Date = new Date()
): Record<string, unknown> {
  const month = monthWindow(cooperativeToday(now));
  if (!month) return where;
  const existing = where.date as DateWhere | undefined;

  const gte = existing?.gte && existing.gte > month.start ? existing.gte : month.start;
  // The filter's own upper bound, when it is the tighter of the two. It used
  // to be read as `lte` — the shape this stopped being when the filters moved
  // to a half-open window — so the intersection had quietly become a no-op
  // and the month figure ignored the filter's end date entirely.
  const lt = existing?.lt && existing.lt < month.end ? existing.lt : month.end;

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
