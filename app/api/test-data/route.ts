import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Staff tool for wiping every trace of a test member account (e.g.
// TEST9999) in one shot, instead of hand-running DELETEs against five
// tables after every live test. GET previews what would be removed;
// DELETE actually removes it. Both key off a member number and follow the
// same trail the data was written along: rows stamped with the member
// number itself, plus rows keyed by any LINE user id tied to that member
// number (via LineUser or the imported roster).

async function relatedLineUserIds(memberNumber: string): Promise<string[]> {
  const [users, roster] = await Promise.all([
    prisma.lineUser.findMany({ where: { memberNumber }, select: { id: true } }),
    prisma.memberRoster.findMany({
      where: { memberNumber },
      select: { lineUserId: true },
    }),
  ]);
  return Array.from(
    new Set([
      ...users.map((u) => u.id),
      ...roster.map((r) => r.lineUserId).filter((id): id is string => id !== null),
    ])
  );
}

function buildWheres(memberNumber: string, lineUserIds: string[]) {
  const byNumberOrUser = {
    OR: [{ memberNumber }, { lineUserId: { in: lineUserIds } }],
  };
  // Pending* tables have no memberNumber column — they only exist keyed by
  // LINE user id. Prisma treats `in: []` as matching nothing, which is
  // exactly right when no LINE account is tied to this member number.
  const byUser = { lineUserId: { in: lineUserIds } };
  return { byNumberOrUser, byUser };
}

function parseMemberNumber(request: NextRequest): string | null {
  const memberNumber = request.nextUrl.searchParams.get("memberNumber")?.trim();
  return memberNumber ? memberNumber : null;
}

export async function GET(request: NextRequest) {
  const memberNumber = parseMemberNumber(request);
  if (!memberNumber) {
    return NextResponse.json({ error: "ต้องระบุเลขสมาชิก" }, { status: 400 });
  }

  const lineUserIds = await relatedLineUserIds(memberNumber);
  const { byNumberOrUser, byUser } = buildWheres(memberNumber, lineUserIds);

  const [expenses, serviceRequestLogs, pendingTransactions, pendingServiceRequests, pendingMemberLookups, memberRoster, lineUsers] =
    await Promise.all([
      prisma.expense.count({ where: byNumberOrUser }),
      prisma.serviceRequestLog.count({ where: byNumberOrUser }),
      prisma.pendingTransaction.count({ where: byUser }),
      prisma.pendingServiceRequest.count({ where: byUser }),
      prisma.pendingMemberLookup.count({ where: byUser }),
      prisma.memberRoster.count({ where: { memberNumber } }),
      prisma.lineUser.count({ where: { id: { in: lineUserIds } } }),
    ]);

  return NextResponse.json({
    memberNumber,
    counts: {
      expenses,
      serviceRequestLogs,
      pendingTransactions,
      pendingServiceRequests,
      pendingMemberLookups,
      memberRoster,
      lineUsers,
    },
  });
}

export async function DELETE(request: NextRequest) {
  const memberNumber = parseMemberNumber(request);
  if (!memberNumber) {
    return NextResponse.json({ error: "ต้องระบุเลขสมาชิก" }, { status: 400 });
  }

  const lineUserIds = await relatedLineUserIds(memberNumber);
  const { byNumberOrUser, byUser } = buildWheres(memberNumber, lineUserIds);

  // No relations between these tables (by design), so order doesn't matter.
  const [expenses, serviceRequestLogs, pendingTransactions, pendingServiceRequests, pendingMemberLookups, memberRoster, lineUsers] =
    await Promise.all([
      prisma.expense.deleteMany({ where: byNumberOrUser }),
      prisma.serviceRequestLog.deleteMany({ where: byNumberOrUser }),
      prisma.pendingTransaction.deleteMany({ where: byUser }),
      prisma.pendingServiceRequest.deleteMany({ where: byUser }),
      prisma.pendingMemberLookup.deleteMany({ where: byUser }),
      prisma.memberRoster.deleteMany({ where: { memberNumber } }),
      prisma.lineUser.deleteMany({ where: { id: { in: lineUserIds } } }),
    ]);

  return NextResponse.json({
    memberNumber,
    deleted: {
      expenses: expenses.count,
      serviceRequestLogs: serviceRequestLogs.count,
      pendingTransactions: pendingTransactions.count,
      pendingServiceRequests: pendingServiceRequests.count,
      pendingMemberLookups: pendingMemberLookups.count,
      memberRoster: memberRoster.count,
      lineUsers: lineUsers.count,
    },
  });
}
