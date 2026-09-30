import { NextRequest, NextResponse } from "next/server";
import { SplitError, placeShareInRound } from "@/lib/lineSplitStore";

export const dynamic = "force-dynamic";

// Counts one member's share of a divided line in a round staff chose — for a
// share dividing could not place (see lib/splitSharesOutside.ts).
// body: { memberNumber, roundId }
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const memberNumber = String(body.memberNumber ?? "").trim();
  const roundId = String(body.roundId ?? "").trim();
  if (!memberNumber || !roundId) {
    return NextResponse.json({ error: "ต้องระบุเลขสมาชิกและรอบ" }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await placeShareInRound(params.id, memberNumber, roundId)) });
  } catch (err) {
    if (err instanceof SplitError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
