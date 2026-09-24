import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ALREADY_RECORDED_ERROR,
  describeDepositRecord,
  recordProblem,
} from "@/lib/depositRecord";
import { isMemberDeposit } from "@/lib/statementLines";
import { memberNumberKey } from "@/lib/memberNumber";
import { DEDUCTION_CATEGORY } from "@/lib/statementSlipHints";
import { canBridgeToRound } from "@/lib/roundReach";
import { recomputeRoundPayments } from "@/lib/statementRecompute";

export const dynamic = "force-dynamic";

// Records a payment from a bank line nobody claimed.
//
// The daily view lists money that arrived with no slip behind it. Staff ring
// round, find out whose it was, and this is where that answer lands: a
// transaction identical to the one a slip through the bot would have
// produced, except that it says on its face where it came from.
//
// The amount and the date are read from the stored line, never taken from the
// request. What arrived and when is the bank's statement, not something a
// browser gets to assert — the only things the caller supplies are the two
// facts a person actually established on the phone: who paid, and what for.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const memberNumber = memberNumberKey(String(body.memberNumber ?? "")) ?? "";
  const category = String(body.category ?? "").trim();
  const note = String(body.note ?? "").trim() || null;
  // Optional, and only used when the roster cannot supply one. Staff ringing
  // round to place a payment learn the name along with the number, and a
  // transaction filed with a number the roster does not have would otherwise
  // be unnameable — and so unverifiable, which is exactly how a ฿1,800,000
  // deposit got stuck in the review queue with nothing to click.
  const statedName = String(body.memberName ?? "").trim() || null;

  const problem = recordProblem({ memberNumber, category, note: note ?? "" });
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  const line = await prisma.statementLine.findUnique({ where: { id: params.id } });
  if (!line) {
    return NextResponse.json(
      { error: "ไม่พบรายการในสเตทเมนต์นี้ — อาจถูกลบไปแล้ว ลองโหลดหน้านี้ใหม่" },
      { status: 404 }
    );
  }

  // The bank's own postings — fees, outward transfers, institutional money —
  // are not a member paying in, and the daily view never offers them here.
  // Checked anyway: a request reaching this route with one would file
  // cooperative money under a member's name.
  if (!isMemberDeposit(line.channel)) {
    return NextResponse.json(
      { error: "รายการนี้ไม่ใช่เงินที่สมาชิกโอนเข้ามา จึงบันทึกเป็นรายการของสมาชิกไม่ได้" },
      { status: 400 }
    );
  }

  // A transaction has to sit on a day. Every line the parser stores has a
  // date — it is what makes a row a line at all — but the column allows null,
  // so the impossible case says so rather than being written as today.
  if (!line.postedAt) {
    return NextResponse.json(
      { error: "รายการนี้ไม่มีวันที่ในสเตทเมนต์ จึงบันทึกเป็นรายการไม่ได้" },
      { status: 400 }
    );
  }

  // Same rule as the manual entry form: "verified" means the number matched
  // the imported roster, not that a person typed it confidently.
  const rosterMatch = await prisma.memberRoster.findUnique({
    where: { memberNumber },
    select: { memberName: true },
  });

  let expense: {
    id: string;
    amount: number;
    category: string;
    memberNumber: string | null;
    memberFullName: string | null;
  };
  try {
    expense = await prisma.expense.create({
      data: {
        amount: line.amount,
        category,
        description: describeDepositRecord(line, note),
        // The bank's timestamp, so the transaction sits on the day the money
        // actually arrived and the daily view finds it there.
        date: line.postedAt,
        memberNumber,
        // The roster is canonical where it knows the member; the name staff
        // typed is the fallback, not an override.
        memberFullName: rosterMatch?.memberName ?? statedName,
        memberVerified: rosterMatch !== null,
        statementLineId: line.id,
      },
      select: { id: true, amount: true, category: true, memberNumber: true, memberFullName: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: ALREADY_RECORDED_ERROR }, { status: 409 });
    }
    throw err;
  }

  // Filing this as the deduction category is staff saying "this settles what
  // this member owes the newest หักไม่ได้ round" — the same fact the round's
  // own statement upload would have established, just learned by phone
  // instead of by file. Writing it through, when the round agrees this
  // member still owes, closes the gap lib/roundReach.ts otherwise only warns
  // about. Best-effort and never fatal to the recording above: the
  // transaction just filed is the thing staff came here for, and is real
  // whether or not a round happens to be watching this member right now.
  let bridgedRound: { period: string; label: string } | null = null;
  if (category === DEDUCTION_CATEGORY && line.senderAccount) {
    try {
      const latestRound = await prisma.statementRound.findFirst({
        orderBy: { period: "desc" },
        select: { id: true, period: true, label: true },
      });
      if (latestRound) {
        const onRound = await prisma.statementMember.findMany({
          where: { roundId: latestRound.id },
          select: { memberNumber: true, deductionResult: true, status: true },
        });
        const member = onRound.find((m) => memberNumberKey(m.memberNumber) === memberNumber) ?? null;
        if (canBridgeToRound(member)) {
          await prisma.statementTransfer.create({
            data: {
              roundId: latestRound.id,
              memberNumber: member!.memberNumber,
              accountNumber: line.senderAccount,
              amount: line.amount,
              transferredAt: line.postedAt,
              account: line.account,
              branch: line.branch,
              description: line.description,
              // Traceable back to the line it came from, and never mistaken
              // for a fingerprint a real statement upload could also
              // produce — see manualMemberNumber on StatementTransfer for
              // why a collision there would matter.
              fingerprint: `line:${line.fingerprint}`,
              sourceFile: line.sourceFile,
              manualMemberNumber: true,
            },
          });
          await recomputeRoundPayments(latestRound.id);
          bridgedRound = { period: latestRound.period, label: latestRound.label };
        }
      }
    } catch (err) {
      console.error("statement line not bridged to round", err);
    }
  }

  return NextResponse.json({
    ...expense,
    // Flagged rather than refused, the same way the bank-account directory
    // flags a member number the roster has never heard of: it is usually a
    // typo, and staff should see it rather than have the work stopped.
    inRoster: rosterMatch !== null,
    bridgedRound,
  });
}
