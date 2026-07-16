import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json();
  const { title, content, sortOrder } = body;

  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "ต้องระบุหัวข้อ" }, { status: 400 });
  }
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "ต้องระบุเนื้อหา" }, { status: 400 });
  }

  try {
    const entry = await prisma.knowledgeEntry.update({
      where: { id: params.id },
      data: {
        title: title.trim(),
        content: content.trim(),
        ...(Number.isInteger(sortOrder) ? { sortOrder } : {}),
      },
    });
    return NextResponse.json(entry);
  } catch {
    return NextResponse.json({ error: "ไม่พบหัวข้อนี้" }, { status: 404 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.knowledgeEntry.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "ไม่พบหัวข้อนี้" }, { status: 404 });
  }
}
