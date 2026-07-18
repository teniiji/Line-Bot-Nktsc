import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEPARTMENTS } from "@/lib/departments";

export const dynamic = "force-dynamic";

// "สินเชื่อ" is deliberately excluded — it routes per-member via
// ResponsibleContact/LoanDistrictContact (see resolveForwardTargets in
// lib/financeAgent.ts), not via DepartmentContact, so rows added here for
// it would silently never be used.
const ASSIGNABLE_DEPARTMENTS = DEPARTMENTS.filter((d) => d !== "สินเชื่อ");

export async function GET() {
  const contacts = await prisma.departmentContact.findMany({
    orderBy: [{ department: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(contacts);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { department, lineUserId, name } = body;

  if (
    typeof department !== "string" ||
    !(ASSIGNABLE_DEPARTMENTS as readonly string[]).includes(department)
  ) {
    return NextResponse.json(
      { error: `department must be one of ${ASSIGNABLE_DEPARTMENTS.join(", ")}` },
      { status: 400 }
    );
  }
  if (typeof lineUserId !== "string" || !lineUserId.trim()) {
    return NextResponse.json({ error: "ต้องระบุ LINE UserId" }, { status: 400 });
  }

  try {
    const contact = await prisma.departmentContact.create({
      data: {
        department,
        lineUserId: lineUserId.trim(),
        name: typeof name === "string" && name.trim() ? name.trim() : null,
      },
    });
    return NextResponse.json(contact, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "เจ้าหน้าที่คนนี้ถูกเพิ่มในแผนกนี้ไว้แล้ว" },
      { status: 409 }
    );
  }
}
