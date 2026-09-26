import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const removed = await prisma.outOfProvinceMember.deleteMany({ where: { id: params.id } });
  if (removed.count === 0) {
    return NextResponse.json({ error: "ไม่พบรายการนี้" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
