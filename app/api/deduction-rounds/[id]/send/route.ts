import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lineClient } from "@/lib/lineClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sends one unit's file for this round over LINE, or records that staff sent
// it themselves some other way.
//
// Two channels, only one of them automated:
//   line   — pushed here to the unit's contact, as a link. LINE's Messaging
//            API can't attach a spreadsheet (images only), so the message
//            carries the /api/blob link instead; that route is exempt from
//            Basic Auth precisely so a recipient can open it.
//   manual — staff sent it by email (via their own SMTP batch file) or by
//            hand, and are recording that here. This app has no mail
//            transport, so email genuinely cannot be automated from the
//            dashboard, and pretending otherwise would be worse than saying
//            so: units reachable only by email are marked, not silently
//            skipped.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const round = await prisma.deductionRound.findUnique({ where: { id: params.id } });
  if (!round) {
    return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });
  }

  const body = await request.json();
  const unitName = typeof body.unitName === "string" ? body.unitName.trim() : "";
  const channel = body.channel === "manual" ? "manual" : "line";

  if (!unitName) {
    return NextResponse.json({ error: "ต้องระบุหน่วยงาน" }, { status: 400 });
  }

  const file = await prisma.deductionUnitFile.findUnique({
    where: { roundId_unitName: { roundId: round.id, unitName } },
  });
  if (!file) {
    return NextResponse.json({ error: `หน่วยงาน "${unitName}" ไม่ได้อยู่ในรอบนี้` }, { status: 404 });
  }
  if (!file.filePath) {
    return NextResponse.json(
      { error: "ยังไม่ได้อัปโหลดไฟล์ของหน่วยงานนี้" },
      { status: 400 }
    );
  }

  if (channel === "manual") {
    const updated = await prisma.deductionUnitFile.update({
      where: { id: file.id },
      data: { sendStatus: "sent", sentAt: new Date(), sentVia: "manual", sendError: null },
    });
    return NextResponse.json(updated);
  }

  const unit = await prisma.organizationUnit.findUnique({ where: { name: unitName } });
  if (!unit?.lineUserId) {
    return NextResponse.json(
      { error: "หน่วยงานนี้ไม่มี LINE UserID ในระบบ — ส่งเองแล้วกด \"บันทึกว่าส่งแล้ว\" แทน" },
      { status: 400 }
    );
  }

  const origin = new URL(request.url).origin;
  const link = `${origin}/api/blob/${file.filePath}`;
  const text =
    `เรียน ${unit.contactName ?? unit.name}\n\n` +
    `สหกรณ์ออมทรัพย์ครูหนองคาย จำกัด ขอส่งรายการหักเงินประจำเดือน ${round.label}\n` +
    `หน่วยงาน: ${unit.name}\n` +
    (file.amount != null ? `ยอดรวม: ${file.amount.toLocaleString("th-TH")} บาท\n` : "") +
    (file.memberCount != null ? `จำนวนสมาชิก: ${file.memberCount} ราย\n` : "") +
    `\nดาวน์โหลดไฟล์: ${link}`;

  try {
    await lineClient.pushMessage({
      to: unit.lineUserId,
      messages: [{ type: "text", text }],
    });
  } catch (err) {
    console.error("[deduction-rounds] LINE push error:", err);
    const message = err instanceof Error ? err.message : String(err);
    const failed = await prisma.deductionUnitFile.update({
      where: { id: file.id },
      data: {
        sendStatus: "failed",
        sentVia: "line",
        // Truncated: this is surfaced in a table cell, and LINE's errors can
        // run to a full response body.
        sendError: message.slice(0, 300),
      },
    });
    return NextResponse.json(
      { error: "ส่งผ่าน LINE ไม่สำเร็จ", detail: failed.sendError },
      { status: 502 }
    );
  }

  const updated = await prisma.deductionUnitFile.update({
    where: { id: file.id },
    data: { sendStatus: "sent", sentAt: new Date(), sentVia: "line", sendError: null },
  });
  return NextResponse.json(updated);
}

// Set a unit's status by hand — mainly to mark one as deliberately skipped
// this round, or to clear a failure back to pending after fixing the cause.
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json();
  const unitName = typeof body.unitName === "string" ? body.unitName.trim() : "";
  const sendStatus = body.sendStatus;

  if (!unitName) {
    return NextResponse.json({ error: "ต้องระบุหน่วยงาน" }, { status: 400 });
  }
  if (sendStatus !== "pending" && sendStatus !== "skipped") {
    return NextResponse.json(
      { error: 'ตั้งได้เฉพาะ "pending" หรือ "skipped" — สถานะส่งแล้วต้องผ่านการส่งจริง' },
      { status: 400 }
    );
  }

  try {
    const updated = await prisma.deductionUnitFile.update({
      where: { roundId_unitName: { roundId: params.id, unitName } },
      data: { sendStatus, sentAt: null, sentVia: null, sendError: null },
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "ไม่พบหน่วยงานนี้ในรอบ" }, { status: 404 });
  }
}
