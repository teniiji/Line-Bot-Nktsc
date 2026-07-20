import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CATEGORIES } from "@/lib/categories";

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json();
  const { amount, category, description, date, memberFullName, memberNumber } =
    body;

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "จำนวนเงินต้องมากกว่า 0" },
      { status: 400 }
    );
  }
  if (
    typeof category !== "string" ||
    !CATEGORIES.includes(category as (typeof CATEGORIES)[number])
  ) {
    return NextResponse.json({ error: "หมวดหมู่ไม่ถูกต้อง" }, { status: 400 });
  }
  if (!date || isNaN(Date.parse(date))) {
    return NextResponse.json({ error: "วันที่ไม่ถูกต้อง" }, { status: 400 });
  }

  try {
    const existing = await prisma.expense.findUniqueOrThrow({
      where: { id: params.id },
      select: { memberNumber: true, memberVerified: true },
    });

    const trimmedNumber =
      typeof memberNumber === "string" && memberNumber.trim()
        ? memberNumber.trim()
        : null;

    // Changing the member number invalidates the previous verification;
    // re-check the new number against the roster the same way the agent
    // and the create endpoint do.
    let memberVerified = existing.memberVerified;
    if (trimmedNumber !== existing.memberNumber) {
      const rosterMatch = trimmedNumber
        ? await prisma.memberRoster.findUnique({
            where: { memberNumber: trimmedNumber },
          })
        : null;
      memberVerified = rosterMatch !== null;
    }

    const expense = await prisma.expense.update({
      where: { id: params.id },
      data: {
        amount,
        category,
        description:
          typeof description === "string" && description ? description : null,
        date: new Date(date),
        memberFullName:
          typeof memberFullName === "string" && memberFullName.trim()
            ? memberFullName.trim()
            : null,
        memberNumber: trimmedNumber,
        memberVerified,
      },
      select: {
        id: true,
        amount: true,
        category: true,
        description: true,
        date: true,
        createdAt: true,
        memberFullName: true,
        memberNumber: true,
        memberVerified: true,
        loanType: true,
        depositAccountNumber: true,
      },
    });
    return NextResponse.json(expense);
  } catch {
    return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.expense.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 });
  }
}
