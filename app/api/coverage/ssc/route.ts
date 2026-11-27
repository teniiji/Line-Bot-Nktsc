import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkUploadedFile } from "@/lib/excelUpload";
import { classifySsc, parseSscText, SscFileError } from "@/lib/sscRoster";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// สสค.'s member list (lib/sscRoster.ts). Each import is kept; the coverage
// tab and คำนวณก่อนกู้ use the latest.

export async function GET() {
  const data = await prisma.associationRoster.findMany({
    where: { association: "ssc" },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  return NextResponse.json({ data });
}

const WRITE_CHUNK = 1000;

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const checked = checkUploadedFile(form.get("file"));
  if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });
  const benefit = Math.round(Number(String(form.get("benefit") ?? "").replace(/,/g, "")));
  if (!(benefit > 0)) return NextResponse.json({ error: "ต้องใส่เงินสงเคราะห์ที่นับเป็นหลักประกัน" }, { status: 400 });
  const asOfText = String(form.get("asOf") ?? "");
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(asOfText) ? new Date(`${asOfText}T00:00:00Z`) : null;

  // The association's system writes Thai Windows text.
  const bytes = new Uint8Array(await checked.file.arrayBuffer());
  let text: string;
  try {
    text = new TextDecoder("windows-874", { fatal: false }).decode(bytes);
  } catch {
    return NextResponse.json({ error: "อ่านไฟล์ไม่ได้" }, { status: 400 });
  }
  let rows;
  try {
    rows = parseSscText(text);
  } catch (err) {
    if (err instanceof SscFileError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  // Who the cooperative's members are: the roster, and the yearly file for
  // members the roster does not carry.
  const members = new Map<string, string>();
  for (const r of await prisma.memberCoverage.findMany({
    where: { snapshot: { isCurrent: true } },
    select: { memberNumber: true, memberName: true },
  })) {
    if (r.memberName) members.set(r.memberNumber, r.memberName);
  }
  for (const r of await prisma.memberRoster.findMany({ select: { memberNumber: true, memberName: true } })) {
    members.set(r.memberNumber, r.memberName);
  }
  if (members.size === 0) {
    return NextResponse.json({ error: "ยังไม่มีทะเบียนสมาชิกหรือไฟล์ปีในระบบ — นำเข้าไฟล์ปีก่อน" }, { status: 400 });
  }

  const { own, counts } = classifySsc(rows, members);
  if (own.length === 0) return NextResponse.json({ error: "ไม่พบสมาชิกสหกรณ์ที่เป็นสมาชิก สสค. ในไฟล์" }, { status: 400 });

  const label = String(form.get("label") ?? "").trim() || checked.file.name.replace(/\.(xls|txt|csv)$/i, "");
  const roster = await prisma.associationRoster.create({
    data: {
      association: "ssc",
      label,
      benefit,
      asOf,
      fileName: checked.file.name,
      counts: counts as unknown as Prisma.InputJsonValue,
      memberCount: own.length,
    },
  });
  try {
    for (let i = 0; i < own.length; i += WRITE_CHUNK) {
      await prisma.associationRosterMember.createMany({
        data: own.slice(i, i + WRITE_CHUNK).map((o) => ({ ...o, rosterId: roster.id })),
      });
    }
  } catch (err) {
    await prisma.associationRoster.delete({ where: { id: roster.id } });
    throw err;
  }
  return NextResponse.json({ id: roster.id, label, benefit, members: own.length, counts });
}
