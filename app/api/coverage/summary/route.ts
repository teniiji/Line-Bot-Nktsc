import { NextRequest, NextResponse } from "next/server";
import { summarize } from "@/lib/coverage";
import { currentSnapshot, loadCoverageRows, ratesOf } from "@/lib/coverageStore";

export const dynamic = "force-dynamic";

// The cards and the age table: always the whole round, never the filtered
// list, the same rule the expense summary keeps — the overall picture should
// not shrink to whatever the list below happens to be narrowed to.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const snapshot = await currentSnapshot(searchParams.get("snapshot"));
  if (!snapshot) return NextResponse.json({ snapshot: null, summary: null });
  const rows = await loadCoverageRows(snapshot.id, ratesOf(snapshot));
  return NextResponse.json({ snapshot, summary: summarize(rows) });
}
