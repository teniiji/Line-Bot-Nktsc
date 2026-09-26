import { prisma } from "@/lib/prisma";
import { memberNumberKey } from "@/lib/memberNumber";
import { isUnitPayerLine, payerKey, suggestedPayerName } from "@/lib/unitPayer";
import { OTHER_CHANNEL, STAFF_CHANNEL } from "@/lib/statementLines";

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

// A unit on the list is staff saying its money is members' money. Its lines
// the bank's code files under "other" (BSD02, BSD14, SDTRC …) are moved into
// the member-money lists the way "เป็นเงินสมาชิก" moves one line — every one
// of them, now and as later statements arrive — so the next month's transfer
// is there to record or divide without anybody marking it first.
//
// `where` narrows the lines looked at: one account's file just stored, or
// nothing for every line on record. Returns how many were moved.
export async function markUnitLines(
  keys: string[] | null,
  where: { account?: string; fingerprints?: string[] } = {}
): Promise<number> {
  const known = keys ?? (await prisma.unitPayer.findMany({ select: { key: true } })).map((p) => p.key);
  if (known.length === 0) return 0;
  const wanted = new Set(known);
  const candidates = await prisma.statementLine.findMany({
    where: {
      channel: OTHER_CHANNEL,
      amount: { gt: 0 },
      description: { contains: "/" },
      ...(where.account ? { account: where.account } : {}),
      ...(where.fingerprints ? { fingerprint: { in: where.fingerprints } } : {}),
    },
    select: { id: true, description: true },
  });
  const ids = candidates
    .filter((line) => isUnitPayerLine(line.description) && wanted.has(payerKey(line.description) ?? ""))
    .map((line) => line.id);
  if (ids.length === 0) return 0;
  const { count } = await prisma.statementLine.updateMany({
    where: { id: { in: ids } },
    data: { channel: STAFF_CHANNEL },
  });
  return count;
}
