import { prisma } from "@/lib/prisma";
import { memberNumberKey } from "@/lib/memberNumber";
import { isUnitPayerLine, payerKey, suggestedPayerName } from "@/lib/unitPayer";

// A unit's payroll office (BSD02 "…/สำนักงานเลขาธิการสภาการศึกษา") names no
// paying account, so the account directory can never say whose its money
// is. Recording one of its lines for a member is staff saying it instead:
// remembered here against the unit (lib/unitPayer.ts), so next month's
// transfer from the same office is recognised as that member's — at once,
// when the unit pays for one person, or with its people listed ready to
// divide when it pays for several.

export async function rememberUnitMember(
  description: string,
  memberNumber: string,
  amount: number
): Promise<void> {
  if (!isUnitPayerLine(description)) return;
  const key = payerKey(description);
  if (!key) return;
  const payer = await prisma.unitPayer.upsert({
    where: { key },
    // A name staff already gave the unit is kept.
    create: { key, name: suggestedPayerName(description) || "หน่วยงาน" },
    update: {},
  });
  await prisma.unitPayerMember.upsert({
    where: { payerId_memberNumber: { payerId: payer.id, memberNumber } },
    create: { payerId: payer.id, memberNumber, lastAmount: amount },
    update: { lastAmount: amount },
  });
}

// line id → member, for each line from a unit known to pay for exactly one
// member. Units paying for several are left to "แบ่งให้หลายคน".
export async function loadUnitOwners(
  lines: { id: string; senderAccount: string | null; description: string }[]
): Promise<Map<string, string>> {
  const owners = new Map<string, string>();
  const keyOf = new Map<string, string>();
  for (const line of lines) {
    if (line.senderAccount || !isUnitPayerLine(line.description)) continue;
    const key = payerKey(line.description);
    if (key) keyOf.set(line.id, key);
  }
  const keys = [...new Set(keyOf.values())];
  if (keys.length === 0) return owners;
  const payers = await prisma.unitPayer.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });
  if (payers.length === 0) return owners;
  const members = await prisma.unitPayerMember.findMany({
    where: { payerId: { in: payers.map((p) => p.id) } },
    select: { payerId: true, memberNumber: true },
  });
  const soleOf = new Map<string, string>();
  for (const payer of payers) {
    const own = [
      ...new Set(members.filter((m) => m.payerId === payer.id).map((m) => memberNumberKey(m.memberNumber) ?? m.memberNumber)),
    ];
    if (own.length === 1) {
      soleOf.set(payer.key, members.find((m) => m.payerId === payer.id)!.memberNumber);
    }
  }
  for (const [lineId, key] of keyOf) {
    const member = soleOf.get(key);
    if (member) owners.set(lineId, member);
  }
  return owners;
}
