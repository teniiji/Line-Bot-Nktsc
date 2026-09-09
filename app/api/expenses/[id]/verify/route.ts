import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { NO_NAME_TO_VERIFY_ERROR } from "@/lib/depositRecord";

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
  if (!expense.memberNumber) {
    return NextResponse.json(
      { error: "รายการนี้ไม่มีเลขสมาชิกให้ยืนยัน — ใส่เลขสมาชิกด้วยปุ่ม \"แก้ไข\" ก่อน" },
      { status: 400 }
    );
  }

  const existingRoster = await prisma.memberRoster.findUnique({
    where: { memberNumber: expense.memberNumber },
  });

  // The roster's name first, the transaction's second. A transaction can
  // carry a member number without a name — staff recording a payment from a
  // bank line supply the number and the roster supplies the name, so a
  // number the roster does not have leaves the name empty. Refusing on the
  // transaction's own name alone made those rows unverifiable even when the
  // roster knew perfectly well who the member was.
  const memberName = existingRoster?.memberName ?? expense.memberFullName;
  if (!memberName) {
    return NextResponse.json({ error: NO_NAME_TO_VERIFY_ERROR }, { status: 400 });
  }

  if (!existingRoster) {
    await prisma.memberRoster.create({
      data: {
        memberNumber: expense.memberNumber,
        memberName,
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

  // Fill in the name where the transaction had none, so the list stops
  // showing "บันทึกโดยเจ้าหน้าที่" for a member the system can now name.
  // Only where it is missing — a name already on a row is not overwritten.
  await prisma.expense.updateMany({
    where: { memberNumber: expense.memberNumber, memberFullName: null },
    data: { memberFullName: memberName },
  });

  // Verify every transaction this member logged under the same number, not
  // just the row the button was clicked on — they were all flagged for the
  // same reason.
  await prisma.expense.updateMany({
    where: { memberNumber: expense.memberNumber, memberVerified: false },
    data: { memberVerified: true },
  });

  return NextResponse.json({ ok: true, memberNumber: expense.memberNumber, memberName });
}
