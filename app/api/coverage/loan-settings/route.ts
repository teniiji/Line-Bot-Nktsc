import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEFAULT_LOAN_SETTINGS, LOAN_SETTINGS_KEYS, type LoanSettings } from "@/lib/loanCollateral";

export const dynamic = "force-dynamic";

// The two figures คำนวณก่อนกู้ needs from the insurer's terms: the age cover
// ends at, and the yearly premium per 1,000,000.
async function read(): Promise<LoanSettings> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: Object.values(LOAN_SETTINGS_KEYS) } } });
  const get = (k: keyof LoanSettings) => {
    const v = Number(rows.find((r) => r.key === LOAN_SETTINGS_KEYS[k])?.value);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_LOAN_SETTINGS[k];
  };
  return { maxCoverAge: get("maxCoverAge"), premiumPerMillion: get("premiumPerMillion") };
}

export async function GET() {
  return NextResponse.json(await read());
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const maxCoverAge = Number(body.maxCoverAge);
  const premiumPerMillion = Number(body.premiumPerMillion);
  if (!(Number.isInteger(maxCoverAge) && maxCoverAge >= 40 && maxCoverAge <= 120)) {
    return NextResponse.json({ error: "อายุคุ้มครองสูงสุดต้องเป็นจำนวนเต็ม 40–120" }, { status: 400 });
  }
  if (!(premiumPerMillion > 0 && premiumPerMillion < 1_000_000)) {
    return NextResponse.json({ error: "อัตราเบี้ยต้องมากกว่า 0" }, { status: 400 });
  }
  for (const [k, v] of [
    [LOAN_SETTINGS_KEYS.maxCoverAge, maxCoverAge],
    [LOAN_SETTINGS_KEYS.premiumPerMillion, premiumPerMillion],
  ] as const) {
    await prisma.appSetting.upsert({ where: { key: k }, create: { key: k, value: String(v) }, update: { value: String(v) } });
  }
  return NextResponse.json(await read());
}
