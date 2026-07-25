import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateFormLinkUrl } from "@/lib/formLinkValidation";

export const dynamic = "force-dynamic";

export async function GET() {
  const links = await prisma.formLink.findMany({ orderBy: { label: "asc" } });
  return NextResponse.json(links);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { key, label, url } = body;

  if (typeof key !== "string" || !key.trim()) {
    return NextResponse.json({ error: "ต้องระบุ key" }, { status: 400 });
  }
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
    const link = await prisma.formLink.create({
      data: { key: key.trim(), label: label.trim(), url: url.trim() },
    });
    return NextResponse.json(link, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "key นี้มีอยู่แล้ว — ใช้ key อื่น" },
      { status: 409 }
    );
  }
}
