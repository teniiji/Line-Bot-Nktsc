import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Staff-side confirmation for the review queue: marks the transaction's
// member identity as verified, and registers the member in MemberRoster
// (if not already there) so the agent's automatic roster check passes on
// that member's next transaction instead of flagging it again.
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const expense = await prisma.expense.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      memberFullName: true,
      memberNumber: true,
      memberVerified: true,
      lineUserId: true,
    },
  });

  if (!expense) {
    return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 });
  }
  if (!expense.memberNumber || !expense.memberFullName) {
    return NextResponse.json(
      { error: "รายการนี้ไม่มีชื่อ/เลขสมาชิกให้ยืนยัน" },
      { status: 400 }
    );
  }

  const existingRoster = await prisma.memberRoster.findUnique({
    where: { memberNumber: expense.memberNumber },
  });
  if (!existingRoster) {
    await prisma.memberRoster.create({
      data: {
        memberNumber: expense.memberNumber,
        memberName: expense.memberFullName,
        lineUserId: expense.lineUserId,
      },
    });
  } else if (!existingRoster.lineUserId && expense.lineUserId) {
    // Roster row imported from the spreadsheet without a LINE id — link it
    // now that staff confirmed this LINE user is that member.
    await prisma.memberRoster.update({
      where: { memberNumber: expense.memberNumber },
      data: { lineUserId: expense.lineUserId },
    });
  }

  // Verify every transaction this member logged under the same number, not
  // just the row the button was clicked on — they were all flagged for the
  // same reason.
  await prisma.expense.updateMany({
    where: { memberNumber: expense.memberNumber, memberVerified: false },
    data: { memberVerified: true },
  });

  return NextResponse.json({ ok: true });
}
