import { NextRequest, NextResponse } from "next/server";
import { totals } from "@/lib/coverage";
import { queryCoverage } from "@/lib/coverageStore";

export const dynamic = "force-dynamic";

// The member list of a coverage round, filtered and paged. With all=1 the
// whole filtered list comes back (for the CSV export).
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const result = await queryCoverage(searchParams);
  if (!result) return NextResponse.json({ snapshot: null, data: [], total: 0, units: [] });
  const { snapshot, rows, sorted } = result;

  const all = searchParams.get("all") === "1";
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("pageSize")) || 20));
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const data = all ? sorted : sorted.slice((page - 1) * pageSize, page * pageSize);

  const units = [...new Set(rows.map((r) => r.unitName).filter((u): u is string => !!u))].sort((a, b) =>
    a.localeCompare(b, "th")
  );

  return NextResponse.json({
    snapshot,
    data,
    total: sorted.length,
    totals: totals(sorted),
    units,
  });
}
