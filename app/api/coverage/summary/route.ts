import { NextRequest, NextResponse } from "next/server";
import { summarize } from "@/lib/coverage";
import { currentSnapshot, enrollmentsSince, latestSscRoster, loadCoverageRows, ratesWithSsc, shareReportFor } from "@/lib/coverageStore";

export const dynamic = "force-dynamic";

// The cards and the age table: always the whole round, never the filtered
// list, the same rule the expense summary keeps — the overall picture should
// not shrink to whatever the list below happens to be narrowed to.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const snapshot = await currentSnapshot(searchParams.get("snapshot"));
  if (!snapshot) return NextResponse.json({ snapshot: null, summary: null });
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
  return NextResponse.json({
    snapshot: { ...snapshot, benefitSsc: ssc?.benefit ?? 0 },
    shareReport,
    shareReportApplied: applyShares,
    ssc: ssc ? { label: ssc.label, benefit: ssc.benefit, memberCount: ssc.memberCount, createdAt: ssc.createdAt } : null,
    summary: summarize(rows),
  });
}
