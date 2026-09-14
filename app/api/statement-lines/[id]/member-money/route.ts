import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isStaffMarked, markProblem, unmarkProblem } from "@/lib/memberMoneyMark";
import { STAFF_CHANNEL, classifyChannel, extractSenderAccount } from "@/lib/statementLines";

export const dynamic = "force-dynamic";

const NOT_FOUND = "ไม่พบรายการในสเตทเมนต์นี้ — อาจถูกลบไปแล้ว ลองโหลดหน้านี้ใหม่";

// "That one is a member paying in" — said by a person about a line the bank's
// transaction code left unclassified. See lib/memberMoneyMark.ts.
//
// It files nothing. All it does is move the line out of "รายการอื่น" and into
// the list of money nobody has claimed, where the two existing answers —
// ระบุเจ้าของ and บันทึกรายการ — already wait to be given. Whose money it was
// and what it paid for are still questions for the phone.
//
// Nothing is read from the request body: which line it is comes from the URL,
// and everything else about it from the stored row.
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const line = await prisma.statementLine.findUnique({ where: { id: params.id } });
  if (!line) {
    return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  }

  const problem = markProblem(line);
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  // Already marked: say so and change nothing. Two people work the same short
  // list and the second click is not a mistake to report.
  if (isStaffMarked(line.channel)) {
    return NextResponse.json({ id: line.id, amount: line.amount, alreadyMarked: true });
  }

  const updated = await prisma.statementLine.update({
    where: { id: line.id },
    data: {
      channel: STAFF_CHANNEL,
      // Read now rather than at upload: the parser only looks for a paying
      // account on lines it already believes are member money, so an "other"
      // line has none stored even when its description states one plainly.
      // Finding it here is what lets the account directory recognise the payer
      // without anybody typing a number.
      senderAccount: extractSenderAccount(line.description),
    },
    select: { id: true, amount: true, senderAccount: true },
  });

  return NextResponse.json({ ...updated, alreadyMarked: false });
}

// Taking the mark back, which is the only way to correct a wrong one.
//
// Refused once a payment has been filed against the line: undoing then would
// leave that transaction pointing at money the day no longer counts as a
// member's, and the figures would disagree with themselves silently. The
// transaction is deleted first, at the tab that owns it.
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const line = await prisma.statementLine.findUnique({ where: { id: params.id } });
  if (!line) {
    return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  }

  const recordedCount = await prisma.expense.count({ where: { statementLineId: line.id } });
  const problem = unmarkProblem(line, recordedCount);
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 409 });
  }

  const updated = await prisma.statementLine.update({
    where: { id: line.id },
    data: {
      // Back to what the bank's own code says, rather than to a remembered
      // previous value: the code is the answer, and it is still right there.
      channel: classifyChannel(line.txnCode, line.amount),
      senderAccount: null,
    },
    select: { id: true, amount: true, txnCode: true },
  });

  return NextResponse.json(updated);
}
