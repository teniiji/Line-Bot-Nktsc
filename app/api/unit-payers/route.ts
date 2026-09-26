import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { memberNumberKey } from "@/lib/memberNumber";
import { isUnitPayerLine, payerKey, suggestedPayerName, unitMatchMode } from "@/lib/unitPayer";
import { markUnitLines } from "@/lib/unitPayerStore";

export const dynamic = "force-dynamic";

// The units that pay for members in one transfer (lib/unitPayer.ts), with the
// members each is known to pay for — the list staff manage on the
// เงินเข้าประจำวัน tab. Built up by "บันทึกรายการ" and "แบ่งให้หลายคน";
// edited here.
export async function GET(request: NextRequest) {
  const search = new URL(request.url).searchParams.get("search")?.trim().toLowerCase() ?? "";

  const [payers, members] = await Promise.all([
    prisma.unitPayer.findMany({ orderBy: { name: "asc" } }),
    prisma.unitPayerMember.findMany({ orderBy: { memberNumber: "asc" } }),
  ]);
  const numbers = [...new Set(members.flatMap((m) => [m.memberNumber, memberNumberKey(m.memberNumber) ?? m.memberNumber]))];
  const roster = numbers.length
    ? await prisma.memberRoster.findMany({
        where: { memberNumber: { in: numbers } },
        select: { memberNumber: true, memberName: true },
      })
    : [];
  const nameOf = new Map(roster.map((r) => [memberNumberKey(r.memberNumber) ?? r.memberNumber, r.memberName]));

  const data = payers
    .map((payer) => {
      const own = members
        .filter((m) => m.payerId === payer.id)
        .map((m) => ({
          id: m.id,
          memberNumber: m.memberNumber,
          name: nameOf.get(memberNumberKey(m.memberNumber) ?? m.memberNumber) ?? null,
          lastAmount: m.lastAmount,
        }));
      return {
        id: payer.id,
        key: payer.key,
        name: payer.name,
        updatedAt: payer.updatedAt,
        mode: unitMatchMode(own.length),
        members: own,
      };
    })
    .filter(
      (p) =>
        !search ||
        p.name.toLowerCase().includes(search) ||
        p.key.includes(search) ||
        p.members.some((m) => m.memberNumber.includes(search) || (m.name ?? "").toLowerCase().includes(search))
    );

  return NextResponse.json({ data });
}

// A unit added ahead of time, from the text its transfers carry on the
// statement ("Education Coun/สำนักงานเลขาธิการสภาการศึกษา/0012").
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const description = String(body.description ?? "").trim();
  if (!isUnitPayerLine(description)) {
    return NextResponse.json(
      { error: 'วางข้อความรายละเอียดในสเตทเมนต์ของหน่วยงาน ที่มีชื่อหน่วยงานคั่นด้วย "/" เช่น "Education Coun/สำนักงานเลขาธิการสภาการศึกษา"' },
      { status: 400 }
    );
  }
  const key = payerKey(description)!;
  const existing = await prisma.unitPayer.findUnique({ where: { key } });
  if (existing) {
    return NextResponse.json({ error: `มีหน่วยงานนี้อยู่แล้ว (${existing.name})`, id: existing.id }, { status: 409 });
  }
  const name = String(body.name ?? "").trim() || suggestedPayerName(description) || "หน่วยงาน";
  const payer = await prisma.unitPayer.create({ data: { key, name } });
  // Its lines already on record move into the member-money lists now; later
  // ones as their statements arrive.
  const moved = await markUnitLines([key]);
  return NextResponse.json({ id: payer.id, name: payer.name, moved }, { status: 201 });
}
