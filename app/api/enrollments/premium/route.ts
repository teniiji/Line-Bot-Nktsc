import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// POST { ids, paid } — the life premium was collected (or not, to undo).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (!ids.length) return NextResponse.json({ error: "ไม่ได้เลือกรายการ" }, { status: 400 });
  const { count } = await prisma.coverageEnrollment.updateMany({
    where: { id: { in: ids }, product: "life" },
    data: { premiumPaidAt: body.paid === false ? null : new Date() },
  });
  return NextResponse.json({ updated: count });
}
