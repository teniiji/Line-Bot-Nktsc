import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lineClient } from "@/lib/lineClient";
import { recordGroupLeft } from "@/lib/lineGroups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sending a real message is the only way to know a group still works.
// Nothing else tells us: LINE reports no error when the bot is removed from
// a chat until something is actually pushed there, so a department whose
// notifications have been going nowhere for a month looks fine until
// somebody checks. This is that check, and it doubles as the setup step —
// staff add the bot to a group, press it, and see the message arrive.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const group = await prisma.lineGroup.findUnique({ where: { id: params.id } });
  if (!group) {
    return NextResponse.json({ error: "ไม่พบกลุ่มนี้" }, { status: 404 });
  }

  try {
    await lineClient.pushMessage({
      to: group.groupId,
      messages: [
        {
          type: "text",
          text:
            "🔔 ทดสอบการส่งจากระบบสหกรณ์\n\n" +
            "ถ้าเห็นข้อความนี้ แปลว่ากลุ่มนี้พร้อมรับแจ้งเตือนแล้วครับ",
        },
      ],
    });
  } catch (err) {
    console.error("[line-groups] test push failed:", err);
    // A push that fails almost always means the bot is no longer in the
    // chat, so the row is marked rather than leaving a target that looks
    // healthy on screen.
    await recordGroupLeft({ id: group.groupId, kind: group.kind as "group" | "room" });
    return NextResponse.json(
      { error: "ส่งไม่สำเร็จ — บอทน่าจะไม่ได้อยู่ในกลุ่มนี้แล้ว ลองเพิ่มบอทเข้ากลุ่มใหม่" },
      { status: 502 }
    );
  }

  await prisma.lineGroup.update({
    where: { id: group.id },
    data: { lastSeenAt: new Date(), leftAt: null },
  });

  return NextResponse.json({ ok: true });
}

// Makes the bot leave the chat. The row stays, marked, so a target that
// stops working is explainable — and because the bot cannot re-add itself,
// this is not something to do by accident.
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const group = await prisma.lineGroup.findUnique({ where: { id: params.id } });
  if (!group) {
    return NextResponse.json({ error: "ไม่พบกลุ่มนี้" }, { status: 404 });
  }

  try {
    if (group.kind === "room") await lineClient.leaveRoom(group.groupId);
    else await lineClient.leaveGroup(group.groupId);
  } catch (err) {
    // Already gone is the same outcome staff asked for, so this is not
    // reported as a failure — the row is marked either way below.
    console.error("[line-groups] leave failed:", err);
  }

  await recordGroupLeft({ id: group.groupId, kind: group.kind as "group" | "room" });
  return NextResponse.json({ ok: true });
}
