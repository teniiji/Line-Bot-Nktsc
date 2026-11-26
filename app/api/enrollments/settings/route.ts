import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { POLICY_YEAR_END_KEY, parseMonthDay } from "@/lib/enrollment";
import { DEDUCTION_PRODUCTS, feeKey } from "@/lib/enrollmentDeductions";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [POLICY_YEAR_END_KEY, ...DEDUCTION_PRODUCTS.map(feeKey)] } },
  });
  const value = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  return NextResponse.json({
    policyYearEnd: value(POLICY_YEAR_END_KEY),
    fees: Object.fromEntries(DEDUCTION_PRODUCTS.map((p) => [p, Number(value(feeKey(p))) || null])),
  });
}

// PUT { fees: { sok: 20, ... } } — the monthly fee deducted for each.
// PUT { policyYearEnd: "03-31" } — the day and month the life policy year ends.
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (body.fees && typeof body.fees === "object") {
    for (const p of DEDUCTION_PRODUCTS) {
      const raw = body.fees[p];
      if (raw === undefined) continue;
      const n = Number(raw);
      if (raw === null || raw === "") {
        await prisma.appSetting.deleteMany({ where: { key: feeKey(p) } });
      } else if (Number.isFinite(n) && n >= 0) {
        await prisma.appSetting.upsert({
          where: { key: feeKey(p) },
          create: { key: feeKey(p), value: String(n) },
          update: { value: String(n) },
        });
      } else {
        return NextResponse.json({ error: "ค่าบำรุงต้องเป็นตัวเลขไม่ติดลบ" }, { status: 400 });
      }
    }
    if (body.policyYearEnd === undefined) return NextResponse.json({ ok: true });
  }
  const value = String(body.policyYearEnd ?? "");
  if (!parseMonthDay(value)) return NextResponse.json({ error: "รูปแบบวันที่ต้องเป็น เดือน-วัน เช่น 03-31" }, { status: 400 });
  await prisma.appSetting.upsert({
    where: { key: POLICY_YEAR_END_KEY },
    create: { key: POLICY_YEAR_END_KEY, value },
    update: { value },
  });
  return NextResponse.json({ policyYearEnd: value });
}
