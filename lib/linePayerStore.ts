import { prisma } from "@/lib/prisma";
import { payerKey } from "@/lib/unitPayer";
import { payersByKey, resolveLinePayer, type LinePayer, type PayerRef } from "@/lib/linePayer";

// Reads and writes for lib/linePayer.ts: which unit each line is from.

// What staff said about each line: an explicit choice, else the unit a
// division of the line was filed under.
async function chosenFor(lineIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (lineIds.length === 0) return out;
  const [choices, splits] = await Promise.all([
    prisma.statementLinePayer.findMany({ where: { lineId: { in: lineIds } }, select: { lineId: true, payerId: true } }),
    prisma.statementLineSplit.findMany({
      where: { lineId: { in: lineIds }, payerId: { not: null } },
      select: { lineId: true, payerId: true },
    }),
  ]);
  for (const s of splits) if (s.payerId && !out.has(s.lineId)) out.set(s.lineId, s.payerId);
  for (const c of choices) out.set(c.lineId, c.payerId);
  return out;
}

export async function linePayers(
  lines: { id: string; description: string }[]
): Promise<Map<string, LinePayer & { key: string | null }>> {
  const keyOf = new Map(lines.map((l) => [l.id, payerKey(l.description)]));
  const keys = [...new Set([...keyOf.values()].filter((k): k is string => k !== null))];
  const out = new Map<string, LinePayer & { key: string | null }>();
  if (keys.length === 0) {
    for (const l of lines) out.set(l.id, { payer: null, choices: [], key: keyOf.get(l.id) ?? null });
    return out;
  }
  const [payers, chosen] = await Promise.all([
    prisma.unitPayer.findMany({ where: { key: { in: keys } }, select: { id: true, key: true, name: true } }),
    chosenFor(lines.map((l) => l.id)),
  ]);
  const byKey = payersByKey(payers);
  for (const l of lines) {
    const key = keyOf.get(l.id) ?? null;
    const candidates = key ? (byKey.get(key) ?? []) : [];
    out.set(l.id, { ...resolveLinePayer(candidates, chosen.get(l.id) ?? null), key });
  }
  return out;
}

export async function linePayer(line: { id: string; description: string }): Promise<LinePayer & { key: string | null }> {
  return (await linePayers([line])).get(line.id) ?? { payer: null, choices: [], key: null };
}

export async function chooseLinePayer(lineId: string, payerId: string): Promise<void> {
  await prisma.statementLinePayer.upsert({
    where: { lineId },
    create: { lineId, payerId },
    update: { payerId },
  });
}

// The unit a line teaches, when recording or dividing it: the one it is from;
// a new one when its wording names none yet; and none when several share the
// wording and nobody has said which — learning then would put one office's
// member on the other's list.
export async function unitToLearnFrom(
  line: { id: string; description: string },
  newName: string
): Promise<PayerRef | null> {
  const known = await linePayer(line);
  if (known.payer) return known.payer;
  if (known.choices.length > 0 || !known.key) return null;
  const created = await prisma.unitPayer.create({ data: { key: known.key, name: newName } });
  return { id: created.id, name: created.name };
}
