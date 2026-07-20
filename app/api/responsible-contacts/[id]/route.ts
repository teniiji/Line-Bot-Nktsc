import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json();
  const { lineUserId, note } = body;

  if (typeof lineUserId !== "string" || !lineUserId.trim()) {
    return NextResponse.json({ error: "ต้องระบุ LINE UserId" }, { status: 400 });
  }

  try {
    const contact = await prisma.responsibleContact.update({
      where: { id: params.id },
      data: {
        lineUserId: lineUserId.trim(),
        note: typeof note === "string" && note.trim() ? note.trim() : null,
      },
    });
    return NextResponse.json(contact);
  } catch {
    return NextResponse.json({ error: "ไม่พบรหัสนี้" }, { status: 404 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.responsibleContact.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "ไม่พบรหัสนี้" }, { status: 404 });
  }
}
