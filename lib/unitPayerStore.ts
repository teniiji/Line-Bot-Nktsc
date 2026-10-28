import { prisma } from "@/lib/prisma";
import { memberNumberKey } from "@/lib/memberNumber";
import { periodOfDate } from "@/lib/deductionPeriod";
import { isUnitPayerLine, matchUnitLines, payerKey, suggestedPayerName } from "@/lib/unitPayer";
import { OTHER_CHANNEL, STAFF_CHANNEL } from "@/lib/statementLines";
import { linePayers, unitToLearnFrom } from "@/lib/linePayerStore";

// A unit's payroll office (BSD02 "…/สำนักงานเลขาธิการสภาการศึกษา") names no
// paying account, so the account directory can never say whose its money
// is. Recording one of its lines for a member is staff saying it instead:
// remembered here against the unit (lib/unitPayer.ts), so next month's
// transfer from the same office is recognised as that member's — at once,
// when the unit pays for one person, or with its people listed ready to
// divide when it pays for several.

export async function rememberUnitMember(
  line: { id: string; description: string },
  memberNumber: string,
  amount: number
): Promise<void> {
  if (!isUnitPayerLine(line.description)) return;
  // The unit the line is from — a name staff already gave it is kept — or a
  // new one for wording nobody has named. Nothing when several units share
  // the wording and the line has not said which (lib/linePayer.ts).
  const payer = await unitToLearnFrom(line, suggestedPayerName(line.description) || "หน่วยงาน");
  if (!payer) return;
  await prisma.unitPayerMember.upsert({
    where: { payerId_memberNumber: { payerId: payer.id, memberNumber } },
    create: { payerId: payer.id, memberNumber, lastAmount: amount },
    update: { lastAmount: amount },
  });
}

// For each line of a known unit: who it is, where that can be told
// (owners — see matchUnitLines: a one-member unit's only line of the day,
// otherwise the member this month's round, or last month's transfer, puts
// at exactly that amount), and the unit's members to pick from where it
// cannot (picks), each with what the round says the unit should send for
// them this month. Anything ambiguous is left for staff.
export interface UnitPick {
  memberNumber: string;
  name: string | null;
  // This month's ยอดแจ้งหัก (or หักไม่ได้ balance), else last month's amount.
  amount: number | null;
}

export async function loadUnitOwners(
  lines: { id: string; senderAccount: string | null; description: string; amount: number; postedAt: Date | null }[]
): Promise<{ owners: Map<string, string>; picks: Map<string, UnitPick[]> }> {
  const owners = new Map<string, string>();
  const picks = new Map<string, UnitPick[]>();
  // Grouped by the unit each line is from — not by its wording, which
  // several units can share (lib/linePayer.ts). A shared line nobody has
  // placed yet belongs to no unit and gets neither an owner nor picks.
  const unitLinesOf = lines.filter((line) => !line.senderAccount && isUnitPayerLine(line.description));
  const resolved = await linePayers(unitLinesOf);
  const byPayer = new Map<string, { id: string; amount: number; day: string; period: string }[]>();
  for (const line of unitLinesOf) {
    const payerId = resolved.get(line.id)?.payer?.id;
    if (!payerId) continue;
    const day = line.postedAt ? line.postedAt.toISOString().slice(0, 10) : "";
    const period = line.postedAt ? periodOfDate(line.postedAt) : "";
    byPayer.set(payerId, [...(byPayer.get(payerId) ?? []), { id: line.id, amount: line.amount, day, period }]);
  }
  const payers = [...byPayer.keys()].map((id) => ({ id }));
  if (payers.length === 0) return { owners, picks };
  const members = await prisma.unitPayerMember.findMany({
    where: { payerId: { in: payers.map((p) => p.id) } },
    select: { payerId: true, memberNumber: true, lastAmount: true },
  });

  // What each month's round says the unit should send for each of them.
  const periods = [...new Set([...byPayer.values()].flat().map((l) => l.period).filter(Boolean))];
  const numbers = [...new Set(members.flatMap((m) => [m.memberNumber, memberNumberKey(m.memberNumber) ?? m.memberNumber]))];
  const rounds = periods.length
    ? await prisma.statementRound.findMany({ where: { period: { in: periods } }, select: { id: true, period: true } })
    : [];
  const standing =
    rounds.length && numbers.length
      ? await prisma.statementMember.findMany({
          where: { roundId: { in: rounds.map((r) => r.id) }, memberNumber: { in: numbers } },
          select: { roundId: true, memberNumber: true, name: true, deductionResult: true, amountDue: true, amountPaid: true, expectedAmount: true },
        })
      : [];
  const periodOfRound = new Map(rounds.map((r) => [r.id, r.period]));
  const currentOf = new Map<string, Record<string, number[]>>();
  const nameOf = new Map<string, string>();
  for (const row of standing) {
    const key = memberNumberKey(row.memberNumber) ?? row.memberNumber;
    const period = periodOfRound.get(row.roundId) ?? "";
    const amounts = [
      ...(row.expectedAmount && row.expectedAmount > 0 ? [row.expectedAmount] : []),
      ...(row.deductionResult === "uncollected" && row.amountDue > 0 ? [row.amountDue] : []),
    ];
    const entry = currentOf.get(key) ?? {};
    entry[period] = [...(entry[period] ?? []), ...amounts];
    currentOf.set(key, entry);
    if (row.name) nameOf.set(key, row.name);
  }
  const roster = numbers.length
    ? await prisma.memberRoster.findMany({ where: { memberNumber: { in: numbers } }, select: { memberNumber: true, memberName: true } })
    : [];
  for (const r of roster) if (r.memberName) nameOf.set(memberNumberKey(r.memberNumber) ?? r.memberNumber, r.memberName);

  for (const payer of payers) {
    // One row per member, however the number was written.
    const own = [
      ...new Map(
        members
          .filter((m) => m.payerId === payer.id)
          .map((m) => [memberNumberKey(m.memberNumber) ?? m.memberNumber, m])
      ).values(),
    ].map((m) => ({ ...m, current: currentOf.get(memberNumberKey(m.memberNumber) ?? m.memberNumber) }));
    const unitLines = byPayer.get(payer.id) ?? [];
    for (const [lineId, member] of matchUnitLines(unitLines, own)) owners.set(lineId, member);
    for (const line of unitLines) {
      if (owners.has(line.id)) continue;
      picks.set(
        line.id,
        own.map((m) => ({
          memberNumber: m.memberNumber,
          name: nameOf.get(memberNumberKey(m.memberNumber) ?? m.memberNumber) ?? null,
          amount: m.current?.[line.period]?.[0] ?? m.lastAmount,
        }))
      );
    }
  }
  return { owners, picks };
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
