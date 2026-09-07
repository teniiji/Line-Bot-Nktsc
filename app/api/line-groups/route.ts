import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// The group chats the bot has been added to. There is deliberately no POST:
// a group id cannot be typed in, it only ever arrives in a webhook event, so
// the only way onto this list is to actually add the bot to the chat.
export async function GET() {
  const groups = await prisma.lineGroup.findMany({
    orderBy: [{ leftAt: "asc" }, { lastSeenAt: "desc" }],
  });

  // Where each group is already being used, so staff can see what a chat
  // does before removing the bot from it — and so a group that receives
  // nothing is obvious.
  const [units, departments] = await Promise.all([
    prisma.organizationUnit.findMany({
      where: { lineUserId: { in: groups.map((g) => g.groupId) } },
      select: { name: true, lineUserId: true },
    }),
    prisma.departmentContact.findMany({
      where: { lineUserId: { in: groups.map((g) => g.groupId) } },
      select: { department: true, lineUserId: true },
    }),
  ]);

  const usedBy = new Map<string, string[]>();
  for (const unit of units) {
    if (!unit.lineUserId) continue;
    usedBy.set(unit.lineUserId, [...(usedBy.get(unit.lineUserId) ?? []), `หน่วยงาน: ${unit.name}`]);
  }
  for (const contact of departments) {
    usedBy.set(contact.lineUserId, [
      ...(usedBy.get(contact.lineUserId) ?? []),
      `แผนก: ${contact.department}`,
    ]);
  }

  return NextResponse.json(
    groups.map((group) => ({
      id: group.id,
      groupId: group.groupId,
      kind: group.kind,
      name: group.name,
      note: group.note,
      joinedAt: group.joinedAt.toISOString(),
      leftAt: group.leftAt?.toISOString() ?? null,
      lastSeenAt: group.lastSeenAt.toISOString(),
      usedBy: usedBy.get(group.groupId) ?? [],
    }))
  );
}

// Only the staff-written label is editable. Everything else about a group is
// LINE's to say.
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, note } = body;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ error: "ต้องระบุกลุ่ม" }, { status: 400 });
  }

  const group = await prisma.lineGroup.update({
    where: { id },
    data: { note: typeof note === "string" && note.trim() ? note.trim() : null },
  });

  return NextResponse.json({ id: group.id, note: group.note });
}
