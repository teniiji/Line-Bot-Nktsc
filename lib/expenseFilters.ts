const DAY_MS = 24 * 60 * 60 * 1000;

// A day from the filter, as the instant it begins.
//
// Read in UTC, which is what ExpenseFilters already commits to — its presets
// build "today" with toISOString().slice(0, 10). Reading them in the server's
// timezone instead would put the two ends of one filter in different days.
function startOfDay(value: string): Date | null {
  const day = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(day.getTime()) ? null : day;
}

export function buildExpenseWhere(
  searchParams: URLSearchParams
): Record<string, unknown> {
  const category = searchParams.get("category");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const lineUserId = searchParams.get("lineUserId");
  const verified = searchParams.get("verified");

  const where: Record<string, unknown> = {};
  if (category && category !== "All") {
    where.category = category;
  }
  if (lineUserId) {
    where.lineUserId = lineUserId;
  }
  // "false" is the staff review queue: transactions whose member number
  // didn't match the imported roster at log time.
  if (verified === "true" || verified === "false") {
    where.memberVerified = verified === "true";
  }
  // A day is a day, not the instant it begins.
  //
  // `to` used to be `lte: new Date(to)`, which is midnight at the *start* of
  // the last day. So the last day of every range was silently dropped, and a
  // single-day filter matched nothing at all: a transaction carries the time
  // it was logged (parsedDate in lib/agent/transactionHandlers.ts), and none
  // of them happen at exactly midnight.
  //
  // That is why "วันนี้" read "ยังไม่มีรายการที่ตรงกับเงื่อนไข" on a day with
  // ฿2.7M in it, why "เดือนนี้" ended a day early, and why "7 วันล่าสุด" was
  // really six. The end of the range is now the start of the day after,
  // exclusive — the same window the daily reconciliation builds.
  //
  // A bound that cannot be read is left off rather than passed on as an
  // Invalid Date, which Prisma rejects: the answer to a mistyped date is a
  // wider list, never an error page.
  const start = from ? startOfDay(from) : null;
  const lastDay = to ? startOfDay(to) : null;
  const end = lastDay ? new Date(lastDay.getTime() + DAY_MS) : null;
  if (start || end) {
    where.date = {
      ...(start ? { gte: start } : {}),
      ...(end ? { lt: end } : {}),
    };
  }
  return where;
}
