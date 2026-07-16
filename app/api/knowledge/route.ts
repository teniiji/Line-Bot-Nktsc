import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const entries = await prisma.knowledgeEntry.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(entries);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { key, title, content, sortOrder } = body;

  if (typeof key !== "string" || !key.trim()) {
    return NextResponse.json({ error: "ต้องระบุ key" }, { status: 400 });
  }
  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "ต้องระบุหัวข้อ" }, { status: 400 });
  }
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "ต้องระบุเนื้อหา" }, { status: 400 });
  }

  try {
    const entry = await prisma.knowledgeEntry.create({
      data: {
        key: key.trim(),
        title: title.trim(),
        content: content.trim(),
        sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
      },
    });
    return NextResponse.json(entry, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "key นี้มีอยู่แล้ว — ใช้ key อื่น" },
      { status: 409 }
    );
  }
}
