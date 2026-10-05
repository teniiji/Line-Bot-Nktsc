import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Takes a group the bot is no longer in off the list. Only then, and only
// once nothing sends to it: the row is what explains a target that stopped
// working (see DELETE in ../route.ts), so it goes when there is nothing left
// for it to explain. Should the bot be invited back, the group reappears on
// its own.
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const group = await prisma.lineGroup.findUnique({ where: { id: params.id } });
  if (!group) return NextResponse.json({ error: "ไม่พบกลุ่มนี้" }, { status: 404 });
  if (!group.leftAt) {
    return NextResponse.json({ error: "บอทยังอยู่ในกลุ่มนี้ — นำบอทออกก่อน" }, { status: 409 });
  }
  const [contacts, units] = await Promise.all([
    prisma.departmentContact.count({ where: { lineUserId: group.groupId } }),
    prisma.organizationUnit.count({ where: { lineUserId: group.groupId } }),
  ]);
  if (contacts + units > 0) {
    return NextResponse.json(
      { error: "กลุ่มนี้ยังถูกตั้งให้รับแจ้งอยู่ — เอาแผนก/หน่วยงานออกก่อน" },
      { status: 409 }
    );
  }
  await prisma.lineGroup.delete({ where: { id: group.id } });
  return NextResponse.json({ ok: true });
}
