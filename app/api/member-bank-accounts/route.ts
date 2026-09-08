import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeAccountNumber } from "@/lib/statementReconcile";
import { memberNumberKey } from "@/lib/memberNumber";
import { rematchRoundsForAccount } from "@/lib/statementRecompute";

export const dynamic = "force-dynamic";

// The directory of "this bank account belongs to this member", built up as
// staff resolve transfers the หักไม่ได้ sheet could not place. See the
// MemberBankAccount model for why it exists.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() ?? "";

  const where = search
    ? {
        OR: [
          { accountNumber: { contains: search } },
          { memberNumber: { contains: search } },
          { memberName: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const entries = await prisma.memberBankAccount.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  // The roster is the canonical name — memberName on the row is only what was
  // captured when the binding was made, so it can be out of date.
  const roster = await prisma.memberRoster.findMany({
    where: { memberNumber: { in: entries.map((e) => e.memberNumber) } },
    select: { memberNumber: true, memberName: true, unitName: true },
  });
  const rosterByMember = new Map(roster.map((r) => [r.memberNumber, r]));

  return NextResponse.json({
    data: entries.map((entry) => {
      const known = rosterByMember.get(entry.memberNumber);
      return {
        id: entry.id,
        accountNumber: entry.accountNumber,
        memberNumber: entry.memberNumber,
        memberName: known?.memberName ?? entry.memberName ?? null,
        unitName: known?.unitName ?? null,
        // Flagged rather than hidden: a binding to a member number the roster
        // has never heard of is usually a typo, and staff should see it.
        inRoster: Boolean(known),
        note: entry.note,
        updatedAt: entry.updatedAt,
      };
    }),
  });
}

// Binds an account to a member. One account belongs to one member, so posting
// an account that is already bound re-points it rather than failing — that is
// how a mistyped binding gets corrected.
export async function POST(request: NextRequest) {
  const body = await request.json();
  const accountNumber = normalizeAccountNumber(body.accountNumber);
  const memberNumber = memberNumberKey(String(body.memberNumber ?? "")) ?? "";
  const note = String(body.note ?? "").trim() || null;

  if (!accountNumber) {
    return NextResponse.json({ error: "ต้องระบุเลขบัญชี" }, { status: 400 });
  }
  if (!memberNumber) {
    return NextResponse.json({ error: "ต้องระบุเลขสมาชิก" }, { status: 400 });
  }

  const known = await prisma.memberRoster.findUnique({
    where: { memberNumber },
    select: { memberName: true },
  });

  const entry = await prisma.memberBankAccount.upsert({
    where: { accountNumber },
    create: {
      accountNumber,
      memberNumber,
      memberName: known?.memberName ?? (String(body.memberName ?? "").trim() || null),
      note,
    },
    update: {
      memberNumber,
      memberName: known?.memberName ?? (String(body.memberName ?? "").trim() || null),
      note,
    },
  });

  // Re-reconcile wherever this account's money sits, so re-pointing a binding
  // moves the money instead of leaving the change looking inert.
  const rounds = await rematchRoundsForAccount(accountNumber);

  return NextResponse.json({
    id: entry.id,
    accountNumber: entry.accountNumber,
    memberNumber: entry.memberNumber,
    memberName: entry.memberName,
    inRoster: Boolean(known),
    rounds,
  });
}
