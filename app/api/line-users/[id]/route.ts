import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  MEMBER_NUMBER_TAKEN_ERROR,
  memberNumberProblem,
  statedMemberNumber,
  statedValue,
} from "@/lib/memberIdentity";

// Staff can set the member's name and number here as well as their nickname.
//
// Before this they could not, and สังกัด is joined from MemberRoster by the
// member number — so a member the bot never managed to identify showed a dash
// in both columns with no way to fix either. Staff worked around it by typing
// the member number into the nickname box ("พิศวง บ.2 29252"), which no part
// of the system reads.
//
// What this deliberately does NOT do is set MemberRoster.lineUserId. That
// binding says "this LINE account proved it belongs to this member", and only
// the member can prove that, from their own device, through the bot. Staff may
// clear it; nothing here creates it. The consequence is visible and correct:
// loadLineUser still reports verified: false for a staff-entered number, so
// transactions keep logging as "⚠️ ยังไม่ยืนยัน" and the staff notification
// keeps saying so. A person typing a number is weaker evidence than a member
// identifying themselves, and the record should not pretend otherwise.

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json();
  const { nickname, botPaused, fullName, memberNumber } = body;

  if (nickname !== undefined && nickname !== null && typeof nickname !== "string") {
    return NextResponse.json(
      { error: "nickname must be a string or null" },
      { status: 400 }
    );
  }
  if (botPaused !== undefined && typeof botPaused !== "boolean") {
    return NextResponse.json({ error: "botPaused must be a boolean" }, { status: 400 });
  }

  const data: {
    nickname?: string | null;
    botPaused?: boolean;
    fullName?: string | null;
    memberNumber?: string | null;
  } = {};
  if (nickname !== undefined) {
    const trimmed = typeof nickname === "string" ? nickname.trim() : null;
    data.nickname = trimmed || null;
  }
  if (botPaused !== undefined) {
    data.botPaused = botPaused;
  }

  // An empty value clears the field rather than being rejected: staff need to
  // be able to undo a wrong entry, and refusing to clear would leave a typo
  // permanently attached to somebody.
  if (fullName !== undefined) {
    data.fullName = statedValue(fullName);
  }

  if (memberNumber !== undefined) {
    const stated = statedMemberNumber(memberNumber);
    if (stated === null) {
      data.memberNumber = null;
    } else {
      // The same rule the bot applies to a number a member types — asked in
      // one place so the two can never disagree about what is acceptable.
      const problem = memberNumberProblem(stated);
      if (problem) {
        return NextResponse.json({ error: problem }, { status: 400 });
      }

      // The one check standing between a typo and one member's transactions
      // being filed under another member's name. Refused rather than warned
      // about, exactly as the bot refuses it.
      const [roster, otherAccount] = await Promise.all([
        prisma.memberRoster.findUnique({
          where: { memberNumber: stated },
          select: { lineUserId: true },
        }),
        // Also refused when another LINE account merely claims the number
        // without a roster binding. The bot only checks the roster, which was
        // enough while a number could only arrive from the member's own
        // device; typed in by hand, the same digits landing on two accounts is
        // an ordinary slip, and it would file one member's transactions under
        // the other's name.
        prisma.lineUser.findFirst({
          where: { memberNumber: stated, id: { not: params.id } },
          select: { id: true, displayName: true },
        }),
      ]);
      if (roster?.lineUserId && roster.lineUserId !== params.id) {
        return NextResponse.json({ error: MEMBER_NUMBER_TAKEN_ERROR }, { status: 409 });
      }
      if (otherAccount) {
        return NextResponse.json(
          {
            error:
              `${MEMBER_NUMBER_TAKEN_ERROR} (บัญชี "${otherAccount.displayName ?? otherAccount.id}")`,
          },
          { status: 409 }
        );
      }

      data.memberNumber = stated;
    }
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
