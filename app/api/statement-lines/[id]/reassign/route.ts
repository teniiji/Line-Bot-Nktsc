import { NextRequest, NextResponse } from "next/server";
import { ReassignError, reassignRecording } from "@/lib/lineReassignStore";

export const dynamic = "force-dynamic";

// Moves a line recorded for the wrong member to the right one — the
// recording, its round row and the unit's memory together
// (lib/lineReassignStore.ts). body: { memberNumber, memberName? }
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  try {
    const result = await reassignRecording(
      params.id,
      String(body.memberNumber ?? ""),
      String(body.memberName ?? "").trim() || null
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ReassignError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
