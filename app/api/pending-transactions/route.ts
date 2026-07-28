import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  computeNextRequirement,
  describeRequirement,
  loadDisabledRequirements,
} from "@/lib/agent/state";
import type { LineUserInfo } from "@/lib/agent/types";

export const dynamic = "force-dynamic";

// Staff-facing view of PendingTransaction — slips the bot has received but
// hasn't finalized into an Expense yet (still waiting on member info,
// category, loan type, deposit account number, or sender-name
// confirmation — see computeNextRequirement). A member who never replies
// to the bot's follow-up question leaves a row here indefinitely (unlike
// PendingMemberLookup, this table isn't proactively pruned — see
// lib/agent/state.ts's PENDING_TRANSACTION_EXPIRY_MS comment), so this is
// also how staff notice and can manually clear a stuck one.
export async function GET() {
  const [pending, disabled] = await Promise.all([
    prisma.pendingTransaction.findMany({
      orderBy: { createdAt: "desc" },
    }),
    loadDisabledRequirements(),
  ]);

  // PendingTransaction.lineUserId isn't a Prisma relation (see the
  // LineUser model comment in schema.prisma) — batch-fetch the matching
  // LineUser/MemberRoster rows instead of one query per row.
  const lineUserIds = pending.map((p) => p.lineUserId);
  const [lineUsers, rosterEntries] = await Promise.all([
    prisma.lineUser.findMany({
      where: { id: { in: lineUserIds } },
      select: { id: true, displayName: true, nickname: true, fullName: true, memberNumber: true, phone: true },
    }),
    prisma.memberRoster.findMany({
      where: { lineUserId: { in: lineUserIds } },
      select: { lineUserId: true, memberName: true, memberNumber: true },
    }),
  ]);
  const lineUserById = new Map(lineUsers.map((u) => [u.id, u]));
  const rosterByLineUserId = new Map(rosterEntries.map((r) => [r.lineUserId, r]));

  const data = pending.map((p) => {
    const lineUser = lineUserById.get(p.lineUserId);
    const roster = rosterByLineUserId.get(p.lineUserId);
    // Mirrors loadLineUser's own precedence (roster identity wins once
    // linked) so "รอ..." here matches exactly what the bot itself is
    // waiting on, not just an approximation.
    const identity: LineUserInfo | null = roster
      ? { fullName: roster.memberName, memberNumber: roster.memberNumber, verified: true, phone: lineUser?.phone ?? null }
      : lineUser
        ? { fullName: lineUser.fullName, memberNumber: lineUser.memberNumber, verified: false, phone: lineUser.phone }
        : null;

    return {
      id: p.id,
      lineUserId: p.lineUserId,
      displayName: lineUser?.displayName ?? null,
      nickname: lineUser?.nickname ?? null,
      category: p.category,
      amount: p.amount,
      hasSlip: p.hasSlip,
      createdAt: p.createdAt,
      waitingFor: describeRequirement(computeNextRequirement(identity, p, disabled)),
    };
  });

  return NextResponse.json({ data });
}
