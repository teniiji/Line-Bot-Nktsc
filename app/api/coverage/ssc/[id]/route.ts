import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const { count } = await prisma.associationRoster.deleteMany({ where: { id: params.id } });
  if (!count) return NextResponse.json({ error: "ไม่พบรายชื่อ" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
