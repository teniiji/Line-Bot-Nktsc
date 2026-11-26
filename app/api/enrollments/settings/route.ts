import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { POLICY_YEAR_END_KEY, parseMonthDay } from "@/lib/enrollment";

export const dynamic = "force-dynamic";

export async function GET() {
  const row = await prisma.appSetting.findUnique({ where: { key: POLICY_YEAR_END_KEY } });
  return NextResponse.json({ policyYearEnd: row?.value ?? null });
}

// PUT { policyYearEnd: "03-31" } — the day and month the life policy year ends.
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const value = String(body.policyYearEnd ?? "");
  if (!parseMonthDay(value)) return NextResponse.json({ error: "รูปแบบวันที่ต้องเป็น เดือน-วัน เช่น 03-31" }, { status: 400 });
  await prisma.appSetting.upsert({
    where: { key: POLICY_YEAR_END_KEY },
    create: { key: POLICY_YEAR_END_KEY, value },
    update: { value },
  });
  return NextResponse.json({ policyYearEnd: value });
}
