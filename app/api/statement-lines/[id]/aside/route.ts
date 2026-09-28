import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEDUCTION_CATEGORY } from "@/lib/statementSlipHints";
import { recordingAsideProblem } from "@/lib/recordingAside";
import { formatAmount } from "@/lib/format";

export const dynamic = "force-dynamic";

// Sets part of this line's recording aside under another category — see
// lib/recordingAside.ts.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const recording = await prisma.expense.findUnique({ where: { statementLineId: params.id } });
  if (!recording || recording.category !== DEDUCTION_CATEGORY) {
    return NextResponse.json(
      { error: "ไม่พบรายการชำระเก็บไม่ได้รายเดือนที่บันทึกจากบรรทัดนี้" },
      { status: 404 }
    );
  }
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const amount = Math.round(Number(body.amount) * 100) / 100;
  const category = String(body.category ?? "").trim();
  const problem = recordingAsideProblem(recording.amount, amount, category);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const [, aside] = await prisma.$transaction([
    prisma.expense.update({
      where: { id: recording.id },
      data: { amount: Math.round((recording.amount - amount) * 100) / 100 },
    }),
    prisma.expense.create({
      data: {
        amount,
        category,
        description: `${category} ที่ตัดออกจากยอดโอน ${formatAmount(recording.amount)} (บันทึกโดยเจ้าหน้าที่)`,
        date: recording.date,
        memberNumber: recording.memberNumber,
        memberFullName: recording.memberFullName,
        memberVerified: recording.memberVerified,
        asideFromLineId: params.id,
      },
    }),
  ]);
  return NextResponse.json({ ok: true, id: aside.id, amount, category });
}

// Puts a part back into the recording it came from.
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const asideId = new URL(request.url).searchParams.get("asideId") ?? "";
  const aside = await prisma.expense.findFirst({ where: { id: asideId, asideFromLineId: params.id } });
  if (!aside) return NextResponse.json({ error: "ไม่พบส่วนที่ตัดออกนี้" }, { status: 404 });
  const recording = await prisma.expense.findUnique({ where: { statementLineId: params.id } });
  await prisma.$transaction([
    prisma.expense.delete({ where: { id: aside.id } }),
    ...(recording
      ? [
          prisma.expense.update({
            where: { id: recording.id },
            data: { amount: Math.round((recording.amount + aside.amount) * 100) / 100 },
          }),
        ]
      : []),
  ]);
  return NextResponse.json({ ok: true });
}
