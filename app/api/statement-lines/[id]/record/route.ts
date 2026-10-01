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
import { rememberUnitMember } from "@/lib/unitPayerStore";
import { bridgeLineToRound } from "@/lib/lineBridgeStore";
import { parseRecordTarget } from "@/lib/recordCheck";
import { DebtPaymentError, payDebtFromLine } from "@/lib/carriedDebtFromLine";

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
  // Which month a deduction payment is for, when it is not the month it
  // arrived in: an earlier open round, or a carried debt (lib/recordCheck.ts).
  const target = category === DEDUCTION_CATEGORY ? parseRecordTarget(body.target) : null;

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

  // Divided among several members already (lib/unitPayer.ts): recording the
  // whole line for one of them as well would count the money twice.
  if (await prisma.statementLineSplit.count({ where: { lineId: line.id } })) {
    return NextResponse.json(
      { error: 'ยอดนี้แบ่งให้สมาชิกหลายคนไว้แล้ว — ถ้าจะบันทึกให้คนเดียว กด "ยกเลิกการแบ่ง" ก่อน' },
      { status: 409 }
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
  // this member owes the หักไม่ได้ round for the month this payment landed
  // in" — the same fact the round's own statement upload would have
  // established, just learned by phone instead of by file. Writing it
  // through, when that round agrees this member still owes, closes the gap
  // lib/roundReach.ts otherwise only warns about.
  //
  // The round is the one whose MMYY code the payment's own date falls in
  // (periodOfDate), never just "whichever round is newest": a cooperative
  // that opens a new round every month has an August payment and a
  // September round open at once, and grabbing "newest" turned an August
  // payment into an overpayment on September's books the first time this
  // shipped. No round for that month, or the member is not on it — no
  // bridge, same as before.
  //
  // Best-effort and never fatal to the recording above: the transaction just
  // filed is the thing staff came here for, and is real whether or not a
  // round happens to be watching this member right now.
  // A line naming no paying account is a unit's office paying for its
  // people; recording it for this member is remembered against the unit, so
  // next month's transfer from it is recognised (lib/unitPayerStore.ts).
  if (!line.senderAccount && memberNumber) {
    try {
      await rememberUnitMember(line.description, expense.memberNumber ?? memberNumber, line.amount);
    } catch (err) {
      console.error("unit payer not remembered", err);
    }
  }

  // Filing this as the deduction category is staff saying "this settles what
  // this member owes the หักไม่ได้ round for the month this payment landed
  // in" — written through when that round agrees (lib/lineBridgeStore.ts).
  // Best-effort and never fatal to the recording above: the transaction just
  // filed is the thing staff came here for, and is real whether or not a
  // round happens to be watching this member right now.
  //
  // Staff may say which month it pays instead (30047: October money for a
  // month already gone): an earlier round still open takes it as its own
  // row, and a carried debt takes it as a payment — neither then also counts
  // it in the month it arrived.
  let bridgedRound: { period: string; label: string } | null = null;
  let carriedDebt: { sourceLabel: string; amount: number } | null = null;
  let targetProblem: string | null = null;
  if (category === DEDUCTION_CATEGORY && target?.kind === "debt") {
    try {
      const debt = await prisma.carriedDebt.findUnique({
        where: { id: target.id },
        select: { amount: true, amountPaid: true },
      });
      const owed = debt ? Math.round((debt.amount - debt.amountPaid) * 100) / 100 : 0;
      const paid = await payDebtFromLine(target.id, line.id, Math.min(line.amount, owed));
      carriedDebt = { sourceLabel: paid.sourceLabel, amount: paid.amount };
    } catch (err) {
      if (err instanceof DebtPaymentError) targetProblem = err.message;
      else console.error("statement line not paid to carried debt", err);
    }
  } else if (category === DEDUCTION_CATEGORY) {
    try {
      const outcome = await bridgeLineToRound(line, memberNumber, line.amount, target?.id);
      if (outcome.bridged) bridgedRound = { period: outcome.round.period, label: outcome.round.label };
      else if (target) targetProblem = outcome.reason;
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
    carriedDebt,
    // The month staff chose could not take it; the transaction stands.
    targetProblem,
  });
}
