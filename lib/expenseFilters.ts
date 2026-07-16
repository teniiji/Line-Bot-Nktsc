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
  if (from || to) {
    where.date = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }
  return where;
}
