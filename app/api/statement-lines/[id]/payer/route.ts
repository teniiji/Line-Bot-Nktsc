import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { payerKey } from "@/lib/unitPayer";
import { chooseLinePayer } from "@/lib/linePayerStore";
import { payerNamed } from "@/lib/linePayer";

export const dynamic = "force-dynamic";

// Says which unit a bank line is from, where its wording is shared by several
// (lib/linePayer.ts) — one of them, or a new unit with that wording.
// body: { payerId } | { name }
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const line = await prisma.statementLine.findUnique({ where: { id: params.id } });
  if (!line) return NextResponse.json({ error: "ไม่พบรายการนี้" }, { status: 404 });
  const key = payerKey(line.description);
  if (!key) return NextResponse.json({ error: "รายการนี้ไม่มีข้อความที่ใช้จำหน่วยงานได้" }, { status: 400 });

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const sharing = await prisma.unitPayer.findMany({ where: { key }, select: { id: true, name: true } });

  let payer: { id: string; name: string } | null = null;
  if (typeof body.payerId === "string") {
    payer = sharing.find((p) => p.id === body.payerId) ?? null;
    if (!payer) return NextResponse.json({ error: "หน่วยงานนี้ไม่ได้ใช้ข้อความเดียวกับรายการนี้" }, { status: 400 });
  } else {
    const name = String(body.name ?? "").replace(/\s+/g, " ").trim();
    if (name.length < 2) return NextResponse.json({ error: "ต้องระบุชื่อหน่วยงาน" }, { status: 400 });
    // A name one of them already has is that unit, not a second one.
    payer = payerNamed(sharing, name) ?? (await prisma.unitPayer.create({ data: { key, name }, select: { id: true, name: true } }));
  }

  await chooseLinePayer(line.id, payer.id);
  return NextResponse.json({ ok: true, payer });
}
