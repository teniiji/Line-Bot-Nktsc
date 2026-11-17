import { NextResponse } from "next/server";
import { claimFromDashboard } from "@/lib/agent/handoffs";

export const dynamic = "force-dynamic";

// PATCH /api/staff-handoffs/:id — marks a handoff taken, for staff who
// answered the member without tapping รับเรื่องนี้ in LINE.
export async function PATCH(_request: Request, { params }: { params: { id: string } }) {
  const claimed = await claimFromDashboard(params.id);
  if (!claimed) {
    return NextResponse.json({ error: "เรื่องนี้มีคนรับแล้ว หรือไม่พบในระบบ" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
