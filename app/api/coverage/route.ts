import { NextRequest, NextResponse } from "next/server";
import { filterCoverage, parseFilters, sortCoverage, totals, type CoverageSort } from "@/lib/coverage";
import { currentSnapshot, enrollmentsSince, latestSscRoster, loadCoverageRows, ratesWithSsc, shareReportFor } from "@/lib/coverageStore";

export const dynamic = "force-dynamic";

const SORTS: CoverageSort[] = ["margin", "debt", "insured", "age", "member"];

// The member list of a coverage round, filtered and paged. With all=1 the
// whole filtered list comes back (for the CSV export).
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const snapshot = await currentSnapshot(searchParams.get("snapshot"));
  if (!snapshot) return NextResponse.json({ snapshot: null, data: [], total: 0, units: [] });

  // shares=0 shows the file's own shares and debt.
  const shareReport = await shareReportFor(snapshot);
  const applyShares = !!shareReport && searchParams.get("shares") !== "0";
  const ssc = await latestSscRoster();
  const rows = await loadCoverageRows(
    snapshot.id,
    ratesWithSsc(snapshot, ssc),
    searchParams.get("enrollments") === "0" ? null : enrollmentsSince(snapshot),
    applyShares ? shareReport.id : null,
    ssc?.members ?? null
  );
  const filtered = filterCoverage(rows, parseFilters(searchParams));
  const sortParam = searchParams.get("sort") as CoverageSort | null;
  const sorted = sortCoverage(filtered, sortParam && SORTS.includes(sortParam) ? sortParam : "margin");

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
