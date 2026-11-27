import { NextRequest, NextResponse } from "next/server";
import { summarize } from "@/lib/coverage";
import { currentSnapshot, loadRound } from "@/lib/coverageStore";

export const dynamic = "force-dynamic";

// The cards and the age table: always the whole round, never the filtered
// list, the same rule the expense summary keeps — the overall picture should
// not shrink to whatever the list below happens to be narrowed to.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const snapshot = await currentSnapshot(searchParams.get("snapshot"));
  if (!snapshot) return NextResponse.json({ snapshot: null, summary: null });
  const { shareReport, applyShares, ssc, rows, resigned } = await loadRound(snapshot, searchParams);
  return NextResponse.json({
    snapshot: { ...snapshot, benefitSsc: ssc?.benefit ?? 0 },
    shareReport,
    shareReportApplied: applyShares,
    ssc: ssc ? { label: ssc.label, benefit: ssc.benefit, memberCount: ssc.memberCount, createdAt: ssc.createdAt } : null,
    // Members left out because the report says they have left.
    resigned,
    summary: summarize(rows),
  });
}
