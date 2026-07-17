import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Staff-side confirmation for an unverified service request: registers the
// member in MemberRoster using the name/LINE id already captured on the
// request (self-reported by the member when the bot collected it), the
// same way /api/expenses/[id]/verify does for transactions — so a member
// who only ever contacted the bot via a supporting-document request (never
// logged a transaction) still gets recognized automatically next time.
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const entry = await prisma.serviceRequestLog.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      memberFullName: true,
      memberNumber: true,
      lineUserId: true,
    },
  });

  if (!entry) {
    return NextResponse.json({ error: "ไม่พบคำขอนี้" }, { status: 404 });
  }
  if (!entry.memberNumber || !entry.memberFullName) {
    return NextResponse.json(
      { error: "คำขอนี้ไม่มีชื่อ/เลขสมาชิกให้เพิ่มเข้าทะเบียน" },
      { status: 400 }
    );
  }

  const existingRoster = await prisma.memberRoster.findUnique({
    where: { memberNumber: entry.memberNumber },
  });
  if (!existingRoster) {
    await prisma.memberRoster.create({
      data: {
        memberNumber: entry.memberNumber,
        memberName: entry.memberFullName,
        lineUserId: entry.lineUserId,
      },
    });
  } else if (!existingRoster.lineUserId) {
    // Roster row imported from the spreadsheet without a LINE id — link it
    // now that staff confirmed this LINE user is that member.
    await prisma.memberRoster.update({
      where: { memberNumber: entry.memberNumber },
      data: { lineUserId: entry.lineUserId },
    });
  }

  // Verify every service request and transaction logged under the same
  // member number, not just the row the button was clicked on — they were
  // all flagged for the same reason (mirrors /api/expenses/[id]/verify).
  await prisma.serviceRequestLog.updateMany({
    where: { memberNumber: entry.memberNumber, memberVerified: false },
    data: { memberVerified: true },
  });
  await prisma.expense.updateMany({
    where: { memberNumber: entry.memberNumber, memberVerified: false },
    data: { memberVerified: true },
  });

  return NextResponse.json({ ok: true });
}
