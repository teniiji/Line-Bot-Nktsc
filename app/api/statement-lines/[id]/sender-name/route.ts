import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cleanSenderName } from "@/lib/senderName";

export const dynamic = "force-dynamic";

// Who sent this line, as staff found out — before anybody knows which member
// it is (lib/senderName.ts). body: { name } — empty clears it.
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const line = await prisma.statementLine.findUnique({
    where: { id: params.id },
    select: { id: true, senderAccount: true },
  });
  if (!line) return NextResponse.json({ error: "ไม่พบรายการนี้" }, { status: 404 });
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const name = cleanSenderName(body.name);

  // By account when there is one: the same sender's next transfer reads the
  // same without being named again.
  const where = line.senderAccount ? { accountNumber: line.senderAccount } : { lineId: line.id };
  if (!name) {
    await prisma.senderName.deleteMany({ where });
    return NextResponse.json({ ok: true, name: null });
  }
  await prisma.senderName.upsert({
    where: line.senderAccount ? { accountNumber: line.senderAccount } : { lineId: line.id },
    create: { ...where, name },
    update: { name },
  });
  return NextResponse.json({ ok: true, name, byAccount: !!line.senderAccount });
}
