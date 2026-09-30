import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { memberNumberKey } from "@/lib/memberNumber";
import { periodOfDate } from "@/lib/deductionPeriod";
import type { RecordCheck } from "@/lib/recordCheck";

export const dynamic = "force-dynamic";

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// What the round already knows about the member a line is about to be
// recorded for (lib/recordCheck.ts). ?memberNumber=
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const raw = (request.nextUrl.searchParams.get("memberNumber") ?? "").trim();
  const key = memberNumberKey(raw);
  const line = await prisma.statementLine.findUnique({ where: { id: params.id } });
  if (!line || !key) return NextResponse.json({ error: "ไม่พบรายการ หรือเลขสมาชิกไม่ถูกต้อง" }, { status: 400 });

  const spellings = [...new Set([raw, key])];
  const round = line.postedAt
    ? await prisma.statementRound.findUnique({
        where: { period: periodOfDate(line.postedAt) },
        select: { id: true, label: true },
      })
    : null;
  const member = round
    ? await prisma.statementMember.findFirst({
        where: { roundId: round.id, memberNumber: { in: spellings } },
        select: { memberNumber: true, deductionResult: true, amountDue: true, expectedAmount: true, amountPaid: true },
      })
    : null;

  const near = line.postedAt
    ? { gte: new Date(line.postedAt.getTime() - WINDOW_MS), lte: new Date(line.postedAt.getTime() + WINDOW_MS) }
    : undefined;
  const same = (amount: number) => Math.abs(amount - line.amount) < 0.01;
  const [inRound, recorded] = await Promise.all([
    round && member
      ? prisma.statementTransfer.findMany({
          where: {
            roundId: round.id,
            memberNumber: member.memberNumber,
            excludedReason: null,
            NOT: { fingerprint: { startsWith: `line:${line.fingerprint}` } },
          },
          select: { amount: true, transferredAt: true },
        })
      : Promise.resolve([]),
    prisma.expense.findMany({
      where: {
        memberNumber: { in: spellings },
        ...(near ? { date: near } : {}),
        OR: [{ statementLineId: null }, { statementLineId: { not: line.id } }],
      },
      select: { amount: true, date: true },
    }),
  ]);

  const check: RecordCheck = {
    roundLabel: round?.label ?? null,
    onRound: member !== null,
    deductionResult: member?.deductionResult,
    amountDue: member?.amountDue,
    expectedAmount: member?.expectedAmount ?? null,
    amountPaid: member?.amountPaid,
    sameAmount: [
      ...inRound
        .filter((t) => same(t.amount))
        .map((t) => ({ amount: t.amount, date: (t.transferredAt ?? line.postedAt ?? new Date()).toISOString(), where: "round" as const })),
      ...recorded
        .filter((e) => same(e.amount))
        .map((e) => ({ amount: e.amount, date: e.date.toISOString(), where: "recorded" as const })),
    ].slice(0, 3),
  };
  return NextResponse.json(check);
}
