import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const contacts = await prisma.responsibleContact.findMany({
    orderBy: { code: "asc" },
  });
  return NextResponse.json(contacts);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { code, lineUserId, note } = body;

  if (typeof code !== "string" || !code.trim()) {
    return NextResponse.json({ error: "ต้องระบุรหัสผู้รับผิดชอบ" }, { status: 400 });
  }
  if (typeof lineUserId !== "string" || !lineUserId.trim()) {
    return NextResponse.json({ error: "ต้องระบุ LINE UserId" }, { status: 400 });
  }

  try {
    const contact = await prisma.responsibleContact.create({
      data: {
        code: code.trim(),
        lineUserId: lineUserId.trim(),
        note: typeof note === "string" && note.trim() ? note.trim() : null,
      },
    });
    return NextResponse.json(contact, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "รหัสนี้มีอยู่แล้ว — แก้ไขรายการเดิมแทนการเพิ่มใหม่" },
      { status: 409 }
    );
  }
}
