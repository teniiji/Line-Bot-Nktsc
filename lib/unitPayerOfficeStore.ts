import { prisma } from "@/lib/prisma";
import { planOfficeSync } from "@/lib/unitPayerOffices";

// Brings every unit's members in line with the offices linked to it (see
// lib/unitPayerOffices.ts). The tables are a few hundred rows each, so it
// always plans over all of them — one rule, applied the same way after a
// link, an unlink, an import or a removal.
export async function syncOfficeMembers(): Promise<{ added: number; removed: number }> {
  const [links, officeMembers, unitMembers] = await Promise.all([
    prisma.unitPayerOffice.findMany({ select: { payerId: true, deductingUnit: true } }),
    prisma.outOfProvinceMember.findMany({ select: { memberNumber: true, deductingUnit: true } }),
    prisma.unitPayerMember.findMany({
      select: { id: true, payerId: true, memberNumber: true, viaOffice: true, lastAmount: true },
    }),
  ]);
  const plan = planOfficeSync(
    links.map((l) => ({ payerId: l.payerId, office: l.deductingUnit })),
    officeMembers.map((m) => ({ memberNumber: m.memberNumber, office: m.deductingUnit })),
    unitMembers
  );
  if (plan.add.length === 0 && plan.remove.length === 0) return { added: 0, removed: 0 };
  await prisma.$transaction([
    prisma.unitPayerMember.deleteMany({ where: { id: { in: plan.remove } } }),
    prisma.unitPayerMember.createMany({
      data: plan.add.map((a) => ({ payerId: a.payerId, memberNumber: a.memberNumber, viaOffice: a.viaOffice })),
      skipDuplicates: true,
    }),
  ]);
  return { added: plan.add.length, removed: plan.remove.length };
}
