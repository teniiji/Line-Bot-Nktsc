import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Lets staff clear a stuck PendingTransaction — e.g. a member sent a slip,
// got asked a follow-up question, and never replied. Deleting it here only
// discards this in-progress collection state; it never touched Expense, so
// nothing "recorded" is being undone. If the member messages again later,
// a fresh PendingTransaction starts from scratch.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.pendingTransaction.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "ไม่พบรายการนี้" }, { status: 404 });
  }
}
