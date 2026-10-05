import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseGroupUsage, planGroupUsage, usageRefusal } from "@/lib/lineGroupUsage";

export const dynamic = "force-dynamic";

// Sets what this group receives — the departments whose requests go to it
// and the units whose รายการหัก go to it — from the group's own row. See
// lib/lineGroupUsage.ts. body: { departments: string[], units: string[] }
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const group = await prisma.lineGroup.findUnique({ where: { id: params.id } });
  if (!group) return NextResponse.json({ error: "ไม่พบกลุ่มนี้" }, { status: 404 });

  const wanted = parseGroupUsage(await request.json().catch(() => null));
  if ("error" in wanted) return NextResponse.json({ error: wanted.error }, { status: 400 });

  const [contacts, units] = await Promise.all([
    prisma.departmentContact.findMany({ where: { lineUserId: group.groupId }, select: { department: true } }),
    prisma.organizationUnit.findMany({ where: { lineUserId: group.groupId }, select: { name: true } }),
  ]);
  const plan = planGroupUsage(
    { departments: contacts.map((c) => c.department), units: units.map((u) => u.name) },
    wanted
  );
  const refusal = usageRefusal(plan, group.leftAt !== null);
  if (refusal) return NextResponse.json({ error: refusal }, { status: 409 });

  if (plan.assignUnits.length) {
    const found = await prisma.organizationUnit.findMany({
      where: { name: { in: plan.assignUnits } },
      select: { name: true },
    });
    const missing = plan.assignUnits.filter((n) => !found.some((u) => u.name === n));
    if (missing.length) {
      return NextResponse.json({ error: `ไม่พบหน่วยงาน: ${missing.join(", ")}` }, { status: 400 });
    }
  }

  const label = group.note ?? group.name ?? null;
  await prisma.$transaction([
    prisma.departmentContact.deleteMany({
      where: { lineUserId: group.groupId, department: { in: plan.removeDepartments } },
    }),
    ...plan.addDepartments.map((department) =>
      prisma.departmentContact.create({ data: { department, lineUserId: group.groupId, name: label } })
    ),
    prisma.organizationUnit.updateMany({
      where: { lineUserId: group.groupId, name: { in: plan.releaseUnits } },
      data: { lineUserId: null },
    }),
    prisma.organizationUnit.updateMany({
      where: { name: { in: plan.assignUnits } },
      data: { lineUserId: group.groupId },
    }),
  ]);

  return NextResponse.json({ ok: true, ...plan });
}
