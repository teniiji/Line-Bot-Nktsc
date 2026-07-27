import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json();
  const { nickname, botPaused } = body;

  if (nickname !== undefined && nickname !== null && typeof nickname !== "string") {
    return NextResponse.json(
      { error: "nickname must be a string or null" },
      { status: 400 }
    );
  }
  if (botPaused !== undefined && typeof botPaused !== "boolean") {
    return NextResponse.json({ error: "botPaused must be a boolean" }, { status: 400 });
  }

  const data: { nickname?: string | null; botPaused?: boolean } = {};
  if (nickname !== undefined) {
    const trimmed = typeof nickname === "string" ? nickname.trim() : null;
    data.nickname = trimmed || null;
  }
  if (botPaused !== undefined) {
    data.botPaused = botPaused;
  }

  try {
    const user = await prisma.lineUser.update({
      where: { id: params.id },
      data,
      select: {
        id: true,
        displayName: true,
        nickname: true,
        fullName: true,
        memberNumber: true,
        botPaused: true,
        createdAt: true,
      },
    });
    return NextResponse.json(user);
  } catch {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
}

// LineUser has no foreign-key relations pointing at it (Expense,
// PendingTransaction, PendingServiceRequest, PendingMemberLookup all store
// lineUserId as a plain string, not a Prisma relation — see the comment on
// the LineUser model in prisma/schema.prisma) — deleting a row here only
// removes this person's nickname/botPaused/displayName record. Their
// transaction/service-request history stays intact (it's keyed to
// MemberRoster, not LineUser), and if they message the bot again a fresh
// row is created for them automatically like any new member.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.lineUser.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
}
