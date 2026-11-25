import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const RATE_FIELDS = ["benefitSok", "benefitScs", "benefitSst", "benefitSsk", "welfarePerPeriod", "welfareCap"] as const;

// Editing a round: its label, its rates, or making it the one the tab shows.
// Rates are whole baht and never negative; anything else is refused rather
// than stored, because every total on the tab is built from them.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

  if (typeof body.label === "string" && body.label.trim()) data.label = body.label.trim();
  for (const f of RATE_FIELDS) {
    if (body[f] === undefined) continue;
    const n = Number(body[f]);
    if (!Number.isInteger(n) || n < 0) {
      return NextResponse.json({ error: `ค่า ${f} ต้องเป็นจำนวนเต็มบาทไม่ติดลบ` }, { status: 400 });
    }
    data[f] = n;
  }

  const exists = await prisma.coverageSnapshot.findUnique({ where: { id: params.id } });
  if (!exists) return NextResponse.json({ error: "ไม่พบรอบข้อมูล" }, { status: 404 });

  const updated = await prisma.$transaction(async (tx) => {
    if (body.isCurrent === true) {
      await tx.coverageSnapshot.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      data.isCurrent = true;
    }
    return tx.coverageSnapshot.update({ where: { id: params.id }, data });
  });
  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const exists = await prisma.coverageSnapshot.findUnique({ where: { id: params.id } });
  if (!exists) return NextResponse.json({ error: "ไม่พบรอบข้อมูล" }, { status: 404 });
  await prisma.coverageSnapshot.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
