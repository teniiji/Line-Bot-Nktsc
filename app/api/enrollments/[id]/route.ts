import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { STATUSES } from "@/lib/enrollment";

export const dynamic = "force-dynamic";

// PATCH — set the insurer's or association's decision by hand.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const status = String(body.status ?? "");
  if (!(status in STATUSES)) return NextResponse.json({ error: "สถานะไม่ถูกต้อง" }, { status: 400 });
  try {
    const updated = await prisma.coverageEnrollment.update({
      where: { id: params.id },
      data: { status, statusDate: status === "pending" ? null : new Date(), statusSource: status === "pending" ? null : "เจ้าหน้าที่" },
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 });
  }
}

// DELETE — a row recorded by mistake.
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const { count } = await prisma.coverageEnrollment.deleteMany({ where: { id: params.id } });
  return count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 });
}
