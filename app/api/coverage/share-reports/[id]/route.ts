import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// A report imported by mistake (the wrong month, the wrong file).
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const { count } = await prisma.shareDebtReport.deleteMany({ where: { id: params.id } });
  if (!count) return NextResponse.json({ error: "ไม่พบรายงาน" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
