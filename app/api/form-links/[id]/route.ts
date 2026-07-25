import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateFormLinkUrl } from "@/lib/formLinkValidation";

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json();
  const { label, url } = body;

  if (typeof label !== "string" || !label.trim()) {
    return NextResponse.json({ error: "ต้องระบุชื่อแบบฟอร์ม" }, { status: 400 });
  }
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "ต้องระบุลิงก์" }, { status: 400 });
  }
  const urlError = validateFormLinkUrl(url.trim());
  if (urlError) {
    return NextResponse.json({ error: urlError }, { status: 400 });
  }

  try {
    const link = await prisma.formLink.update({
      where: { id: params.id },
      data: { label: label.trim(), url: url.trim() },
    });
    return NextResponse.json(link);
  } catch {
    return NextResponse.json({ error: "ไม่พบแบบฟอร์มนี้" }, { status: 404 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.formLink.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "ไม่พบแบบฟอร์มนี้" }, { status: 404 });
  }
}
