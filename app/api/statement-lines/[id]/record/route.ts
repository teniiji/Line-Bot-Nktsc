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

  const problem = recordProblem({ memberNumber, category });
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

  try {
    const expense = await prisma.expense.create({
      data: {
        amount: line.amount,
        category,
        description: describeDepositRecord(line, note),
        // The bank's timestamp, so the transaction sits on the day the money
        // actually arrived and the daily view finds it there.
        date: line.postedAt,
        memberNumber,
        memberFullName: rosterMatch?.memberName ?? null,
        memberVerified: rosterMatch !== null,
        statementLineId: line.id,
      },
      select: { id: true, amount: true, category: true, memberNumber: true, memberFullName: true },
    });

    return NextResponse.json({
      ...expense,
      // Flagged rather than refused, the same way the bank-account directory
      // flags a member number the roster has never heard of: it is usually a
      // typo, and staff should see it rather than have the work stopped.
      inRoster: rosterMatch !== null,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: ALREADY_RECORDED_ERROR }, { status: 409 });
    }
    throw err;
  }
}
