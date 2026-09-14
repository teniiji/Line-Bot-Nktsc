import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serverless request bodies are capped well below this, but a unit's รายการหัก
// sheet is tens to a few hundred KB — anything near the cap is a wrong file
// (a whole folder zipped, a scan) and is better refused with a clear message
// than half-uploaded.
const MAX_BYTES = 4 * 1024 * 1024;

const ALLOWED_EXTENSIONS = [".xlsx", ".xls"];

// Takes one unit's file for this round and stores it. Same Blob pattern as
// slip images (app/api/line/webhook): upload privately, hand back a path
// served through /api/blob, which is exempt from the dashboard's Basic Auth —
// so the link keeps working when it's forwarded to a unit over LINE, where
// the recipient has no dashboard credentials.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const round = await prisma.deductionRound.findUnique({ where: { id: params.id } });
  if (!round) {
    return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });
  }

  const form = await request.formData();
  const unitName = form.get("unitName");
  const file = form.get("file");

  if (typeof unitName !== "string" || !unitName.trim()) {
    return NextResponse.json({ error: "ต้องระบุหน่วยงาน" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "ต้องแนบไฟล์" }, { status: 400 });
  }
  const lowerName = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
    return NextResponse.json(
      { error: "รองรับเฉพาะไฟล์ Excel (.xlsx / .xls)" },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `ไฟล์ใหญ่เกิน ${Math.round(MAX_BYTES / 1024 / 1024)} MB — ตรวจสอบว่าแนบไฟล์ถูกตัวไหม` },
      { status: 400 }
    );
  }

  const existing = await prisma.deductionUnitFile.findUnique({
    where: { roundId_unitName: { roundId: round.id, unitName: unitName.trim() } },
  });
  if (!existing) {
    return NextResponse.json(
      { error: `หน่วยงาน "${unitName}" ไม่ได้อยู่ในรอบนี้` },
      { status: 404 }
    );
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "ยังไม่ได้ตั้งค่า BLOB_READ_WRITE_TOKEN จึงเก็บไฟล์ไม่ได้" },
      { status: 503 }
    );
  }

  // Timestamped path so re-uploading a corrected file never overwrites the
  // one already sent to a unit — the old link keeps resolving to exactly what
  // they received.
  const safeName = file.name.replace(/[^\w.\-฀-๿]+/g, "_");
  const pathname = `deductions/${round.period}/${Date.now()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await put(pathname, buffer, {
      access: "private",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  } catch (err) {
    console.error("[deduction-rounds] blob upload error:", err);
    return NextResponse.json({ error: "อัปโหลดไฟล์ไม่สำเร็จ" }, { status: 502 });
  }

  const amountRaw = form.get("amount");
  const memberCountRaw = form.get("memberCount");
  const amount = typeof amountRaw === "string" && amountRaw.trim() ? Number(amountRaw) : null;
  const memberCount =
    typeof memberCountRaw === "string" && memberCountRaw.trim()
      ? Number(memberCountRaw)
      : null;

  const updated = await prisma.deductionUnitFile.update({
    where: { id: existing.id },
    data: {
      fileName: file.name,
      filePath: pathname,
      amount: amount !== null && Number.isFinite(amount) ? amount : null,
      memberCount:
        memberCount !== null && Number.isInteger(memberCount) ? memberCount : null,
      // A replacement file has not been sent, whatever the previous one's
      // status was — otherwise a corrected file silently inherits "sent".
      sendStatus: "pending",
      sentAt: null,
      sentVia: null,
      sendError: null,
    },
  });

  return NextResponse.json({
    id: updated.id,
    unitName: updated.unitName,
    fileName: updated.fileName,
    fileUrl: `/api/blob/${pathname}`,
    amount: updated.amount,
    memberCount: updated.memberCount,
    sendStatus: updated.sendStatus,
  });
}
