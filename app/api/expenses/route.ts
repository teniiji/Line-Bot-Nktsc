import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CATEGORIES } from "@/lib/categories";
import { buildExpenseWhere } from "@/lib/expenseFilters";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

const EXPENSE_SELECT = {
  id: true,
  amount: true,
  category: true,
  description: true,
  date: true,
  createdAt: true,
  lineUserId: true,
  memberFullName: true,
  memberNumber: true,
  memberVerified: true,
  loanType: true,
} as const;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const where = buildExpenseWhere(searchParams);

  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(searchParams.get("pageSize")) || DEFAULT_PAGE_SIZE)
  );

  const [rows, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      select: EXPENSE_SELECT,
      orderBy: { date: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.expense.count({ where }),
  ]);

  // lineUserId is only pulled to resolve a display name and stripped back
  // out of the response afterward.
  const lineUserIds = Array.from(
    new Set(rows.map((r) => r.lineUserId).filter((id): id is string => id !== null))
  );
  const lineUsers = lineUserIds.length
    ? await prisma.lineUser.findMany({
        where: { id: { in: lineUserIds } },
        select: { id: true, displayName: true, nickname: true },
      })
    : [];
  const lineUserMap = new Map(lineUsers.map((u) => [u.id, u]));

  const data = rows.map(({ lineUserId, ...rest }) => ({
    ...rest,
    user: lineUserId
      ? {
          displayName: lineUserMap.get(lineUserId)?.displayName ?? null,
          nickname: lineUserMap.get(lineUserId)?.nickname ?? null,
        }
      : null,
  }));

  return NextResponse.json({ data, total, page, pageSize });
}

export async function POST(request: NextRequest) {
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

  // Manual staff entry mirrors what the LINE agent records: identity is
  // "verified" only when the member number actually matches the imported
  // roster, not merely because staff typed it in.
  const trimmedNumber =
    typeof memberNumber === "string" && memberNumber.trim()
      ? memberNumber.trim()
      : null;
  const rosterMatch = trimmedNumber
    ? await prisma.memberRoster.findUnique({
        where: { memberNumber: trimmedNumber },
      })
    : null;

  const expense = await prisma.expense.create({
    data: {
      amount,
      category,
      description: typeof description === "string" && description ? description : null,
      date: new Date(date),
      memberFullName:
        typeof memberFullName === "string" && memberFullName.trim()
          ? memberFullName.trim()
          : null,
      memberNumber: trimmedNumber,
      memberVerified: rosterMatch !== null,
    },
    select: EXPENSE_SELECT,
  });

  const { lineUserId: _unused, ...rest } = expense;
  return NextResponse.json({ ...rest, user: null }, { status: 201 });
}
