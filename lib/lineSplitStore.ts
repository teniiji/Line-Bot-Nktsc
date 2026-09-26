import { prisma } from "@/lib/prisma";
import { memberNumberKey } from "@/lib/memberNumber";
import { periodOfDate } from "@/lib/deductionPeriod";
import { isMemberDeposit } from "@/lib/statementLines";
import { DEDUCTION_CATEGORY } from "@/lib/statementSlipHints";
import { recomputeRoundPayments } from "@/lib/statementRecompute";
import { formatAmount } from "@/lib/format";
import {
  type SplitPart,
  payerKey,
  splitFingerprint,
  splitProblem,
  splitSourceOf,
  suggestedPayerName,
} from "@/lib/unitPayer";

// Database side of lib/unitPayer.ts: dividing one bank line a unit paid among
// the members it paid for. Each share becomes, for its member,
//   - a transaction on the ธุรกรรม tab (Expense.splitFromLineId), and
//   - a row in the open round for the month the money arrived
//     ("line:<fingerprint>#<member>", placed by staff), so เทียบ Statement
//     counts it — the same way "นับเป็นยอดรอบ …" places a whole line.

export class SplitError extends Error {
  constructor(
    message: string,
    readonly status = 409
  ) {
    super(message);
  }
}

const spellings = (numbers: string[]) => [
  ...new Set(numbers.flatMap((n) => [n.trim(), memberNumberKey(n) ?? n.trim()])),
];

async function openRoundFor(postedAt: Date) {
  const round = await prisma.statementRound.findUnique({
    where: { period: periodOfDate(postedAt) },
    select: { id: true, label: true, closedAt: true },
  });
  return round && !round.closedAt ? round : null;
}

// Why this line cannot be divided as it stands: it already belongs to one
// member some other way, and dividing it as well would count it twice.
async function blockedBecause(line: { id: string; fingerprint: string }): Promise<string | null> {
  const recorded = await prisma.expense.findUnique({
    where: { statementLineId: line.id },
    select: { memberNumber: true },
  });
  if (recorded) {
    return `ยอดนี้บันทึกเป็นรายการของสมาชิก ${recorded.memberNumber ?? ""} ไว้แล้ว — ลบรายการนั้นที่แถบธุรกรรมก่อน แล้วค่อยแบ่ง`;
  }
  const carried = await prisma.carriedDebtPayment.count({ where: { fingerprint: `line:${line.fingerprint}` } });
  if (carried > 0) {
    return 'ยอดนี้ใช้ชำระหนี้ข้ามเดือนไปแล้ว — ลบรายการชำระนั้นที่แถบ "ชำระข้ามเดือน" ก่อน';
  }
  const whole = await prisma.statementTransfer.findFirst({
    where: { fingerprint: `line:${line.fingerprint}` },
    select: { memberNumber: true },
  });
  if (whole) {
    return `ยอดนี้นับเข้ารอบให้สมาชิก ${whole.memberNumber ?? ""} ทั้งก้อนแล้ว — ต้องเอาออกจากรอบก่อนจึงจะแบ่งได้`;
  }
  return null;
}

export async function splitContext(lineId: string) {
  const line = await prisma.statementLine.findUnique({ where: { id: lineId } });
  if (!line) throw new SplitError("ไม่พบรายการเงินเข้านี้", 404);

  const key = payerKey(line.description);
  const payer = key ? await prisma.unitPayer.findUnique({ where: { key } }) : null;
  const remembered = payer
    ? await prisma.unitPayerMember.findMany({
        where: { payerId: payer.id },
        orderBy: { memberNumber: "asc" },
      })
    : [];
  const existing = await prisma.statementLineSplit.findMany({
    where: { lineId: line.id },
    orderBy: { createdAt: "asc" },
  });
  const round = line.postedAt ? await openRoundFor(line.postedAt) : null;

  const numbers = [
    ...new Set([...remembered.map((m) => m.memberNumber), ...existing.map((s) => s.memberNumber)]),
  ];
  const members = await describeMembers(numbers, round?.id ?? null);

  return {
    line: {
      id: line.id,
      amount: line.amount,
      postedAt: line.postedAt,
      description: line.description,
      account: line.account,
    },
    payer: payer ? { id: payer.id, name: payer.name } : null,
    suggestedName: suggestedPayerName(line.description),
    round: round ? { id: round.id, label: round.label } : null,
    remembered: remembered.map((m) => ({
      memberNumber: m.memberNumber,
      lastAmount: m.lastAmount,
      ...members.get(memberNumberKey(m.memberNumber) ?? m.memberNumber),
    })),
    existing: existing.map((s) => ({
      memberNumber: s.memberNumber,
      amount: s.amount,
      ...members.get(memberNumberKey(s.memberNumber) ?? s.memberNumber),
    })),
    blocked: existing.length ? null : await blockedBecause(line),
  };
}

// Name from the roster, and where the member stands on the round the money
// would go to — so staff can divide it against what each one owes.
export async function describeMembers(numbers: string[], roundId: string | null) {
  const out = new Map<
    string,
    { name: string | null; onRound: boolean; status: string | null; owed: number | null }
  >();
  if (numbers.length === 0) return out;
  const variants = spellings(numbers);
  const [roster, standing] = await Promise.all([
    prisma.memberRoster.findMany({
      where: { memberNumber: { in: variants } },
      select: { memberNumber: true, memberName: true },
    }),
    roundId
      ? prisma.statementMember.findMany({
          where: { roundId, memberNumber: { in: variants } },
          select: {
            memberNumber: true,
            name: true,
            status: true,
            deductionResult: true,
            amountDue: true,
            amountPaid: true,
            expectedAmount: true,
          },
        })
      : Promise.resolve([]),
  ]);
  const nameOf = new Map(roster.map((r) => [memberNumberKey(r.memberNumber) ?? r.memberNumber, r.memberName]));
  const standOf = new Map(standing.map((s) => [memberNumberKey(s.memberNumber) ?? s.memberNumber, s]));
  for (const number of numbers) {
    const key = memberNumberKey(number) ?? number;
    const s = standOf.get(key);
    out.set(key, {
      name: nameOf.get(key) ?? s?.name ?? null,
      onRound: !!s,
      status: s?.status ?? null,
      // What the round still wants from them: the uncollected balance, or for
      // someone whose result has not come back, what was asked of payroll.
      owed: s
        ? s.deductionResult === "uncollected"
          ? Math.max(0, Math.round((s.amountDue - s.amountPaid) * 100) / 100)
          : s.deductionResult === "awaiting"
            ? s.expectedAmount
            : 0
        : null,
    });
  }
  return out;
}

export async function applySplit(lineId: string, payerName: string, parts: SplitPart[]) {
  const line = await prisma.statementLine.findUnique({ where: { id: lineId } });
  if (!line || !isMemberDeposit(line.channel) || line.amount <= 0) {
    throw new SplitError("ไม่พบรายการเงินเข้านี้", 404);
  }
  if (!line.postedAt) throw new SplitError("รายการนี้ไม่มีวันที่ในสเตทเมนต์ จึงแบ่งไม่ได้", 400);
  const problem = splitProblem(line.amount, parts);
  if (problem) throw new SplitError(problem, 400);

  // Dividing it again replaces the last division.
  if (await prisma.statementLineSplit.count({ where: { lineId: line.id } })) {
    await undoSplit(line.id);
  } else {
    const blocked = await blockedBecause(line);
    if (blocked) throw new SplitError(blocked);
  }

  const key = payerKey(line.description);
  const name = payerName.trim() || suggestedPayerName(line.description) || "หน่วยงาน";
  const payer = key
    ? await prisma.unitPayer.upsert({
        where: { key },
        create: { key, name },
        update: { name },
      })
    : null;

  const round = await openRoundFor(line.postedAt);
  const variants = spellings(parts.map((p) => p.memberNumber));
  const [roster, onRound] = await Promise.all([
    prisma.memberRoster.findMany({
      where: { memberNumber: { in: variants } },
      select: { memberNumber: true, memberName: true },
    }),
    round
      ? prisma.statementMember.findMany({
          where: { roundId: round.id, memberNumber: { in: variants } },
          select: { memberNumber: true },
        })
      : Promise.resolve([]),
  ]);
  const rosterOf = new Map(roster.map((r) => [memberNumberKey(r.memberNumber) ?? r.memberNumber, r]));
  const roundOf = new Map(onRound.map((m) => [memberNumberKey(m.memberNumber) ?? m.memberNumber, m]));

  const placed: string[] = [];
  const notOnRound: string[] = [];
  for (const part of parts) {
    const k = memberNumberKey(part.memberNumber) ?? part.memberNumber;
    const rosterRow = rosterOf.get(k);
    const memberNumber = rosterRow?.memberNumber ?? roundOf.get(k)?.memberNumber ?? part.memberNumber.trim();

    await prisma.statementLineSplit.create({
      data: { lineId: line.id, memberNumber, amount: part.amount, payerId: payer?.id ?? null },
    });
    await prisma.expense.create({
      data: {
        amount: part.amount,
        category: DEDUCTION_CATEGORY,
        description: `แบ่งจากยอด ${name} ${formatAmount(line.amount)} ที่โอนเข้ามาทีเดียว (บันทึกโดยเจ้าหน้าที่)`,
        date: line.postedAt,
        memberNumber,
        memberFullName: rosterRow?.memberName ?? null,
        memberVerified: !!rosterRow,
        splitFromLineId: line.id,
      },
    });
    if (payer) {
      await prisma.unitPayerMember.upsert({
        where: { payerId_memberNumber: { payerId: payer.id, memberNumber } },
        create: { payerId: payer.id, memberNumber, lastAmount: part.amount },
        update: { lastAmount: part.amount },
      });
    }

    const member = roundOf.get(k);
    if (round && member) {
      await prisma.statementTransfer.create({
        data: {
          roundId: round.id,
          memberNumber: member.memberNumber,
          accountNumber: line.senderAccount ?? "",
          amount: part.amount,
          transferredAt: line.postedAt,
          account: line.account,
          branch: line.branch,
          description: `${line.description} (แบ่งจาก ${formatAmount(line.amount)})`,
          fingerprint: splitFingerprint(line.fingerprint, memberNumber),
          sourceFile: line.sourceFile,
          manualMemberNumber: true,
        },
      });
      placed.push(memberNumber);
    } else {
      notOnRound.push(memberNumber);
    }
  }
  if (round && placed.length) await recomputeRoundPayments(round.id);

  return { roundLabel: round?.label ?? null, placed, notOnRound, payerName: name };
}

export async function undoSplit(lineId: string) {
  const line = await prisma.statementLine.findUnique({ where: { id: lineId } });
  if (!line) throw new SplitError("ไม่พบรายการเงินเข้านี้", 404);

  const rows = await prisma.statementTransfer.findMany({
    where: { fingerprint: { startsWith: `line:${line.fingerprint}#` } },
    select: { id: true, roundId: true, carriedAmount: true },
  });
  if (rows.some((r) => r.carriedAmount > 0.01)) {
    throw new SplitError('บางส่วนของยอดนี้ใช้ชำระหนี้ข้ามเดือนไปแล้ว — ลบรายการชำระนั้นที่แถบ "ชำระข้ามเดือน" ก่อน');
  }
  const roundIds = [...new Set(rows.map((r) => r.roundId))];
  const closed = roundIds.length
    ? await prisma.statementRound.count({ where: { id: { in: roundIds }, closedAt: { not: null } } })
    : 0;
  if (closed > 0) {
    throw new SplitError("รอบที่นับยอดนี้ไว้ปิดไปแล้ว — ต้องเปิดรอบอีกครั้งก่อนจึงจะยกเลิกการแบ่งได้");
  }

  await prisma.statementTransfer.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  await prisma.expense.deleteMany({ where: { splitFromLineId: line.id } });
  await prisma.statementLineSplit.deleteMany({ where: { lineId: line.id } });
  for (const roundId of roundIds) await recomputeRoundPayments(roundId);
}

// For the round page: which unit a share came from, on every row that is only
// a share of a bank line — the member's own row otherwise reads as money
// arriving from nowhere, with no account and no name beside it.
export interface SplitOrigin {
  payerName: string | null;
  total: number;
  memberCount: number;
  // The row it was split off, for a split made inside the round.
  fromAccount: string | null;
}

export async function splitOriginsFor(
  roundId: string,
  transfers: { id: string; fingerprint: string; account: string }[]
): Promise<Map<string, SplitOrigin>> {
  const out = new Map<string, SplitOrigin>();
  const sources = transfers
    .map((t) => ({ t, source: splitSourceOf(t.fingerprint) }))
    .filter((s): s is { t: (typeof transfers)[number]; source: NonNullable<ReturnType<typeof splitSourceOf>> } => !!s.source);
  if (sources.length === 0) return out;

  const payers = await prisma.unitPayer.findMany({ select: { id: true, key: true, name: true } });
  const nameById = new Map(payers.map((p) => [p.id, p.name]));
  const nameByKey = new Map(payers.map((p) => [p.key, p.name]));
  const unitOf = (description: string | null) => {
    const key = payerKey(description);
    return key ? (nameByKey.get(key) ?? null) : null;
  };

  // Divided on the daily page: the bank line and the division recorded on it.
  const lineFps = [
    ...new Set(sources.flatMap(({ source }) => (source.kind === "line" ? [source.lineFingerprint] : []))),
  ];
  if (lineFps.length) {
    const lines = await prisma.statementLine.findMany({
      where: { fingerprint: { in: lineFps } },
      select: { id: true, account: true, fingerprint: true, amount: true, description: true },
    });
    const parts = await prisma.statementLineSplit.findMany({
      where: { lineId: { in: lines.map((l) => l.id) } },
      select: { lineId: true, payerId: true },
    });
    const lineOf = new Map(lines.map((l) => [`${l.account}|${l.fingerprint}`, l]));
    for (const { t, source } of sources) {
      if (source.kind !== "line") continue;
      const line = lineOf.get(`${t.account}|${source.lineFingerprint}`);
      if (!line) continue;
      const own = parts.filter((p) => p.lineId === line.id);
      const payerId = own.find((p) => p.payerId)?.payerId ?? null;
      out.set(t.id, {
        payerName: (payerId ? nameById.get(payerId) : null) ?? unitOf(line.description),
        total: line.amount,
        memberCount: own.length,
        fromAccount: null,
      });
    }
  }

  // Split off another row in this round: that row plus every share taken
  // from it make up the line the bank recorded.
  const parentFps = [
    ...new Set(sources.flatMap(({ source }) => (source.kind === "round" ? [source.parentFingerprint] : []))),
  ];
  if (parentFps.length) {
    const family = await prisma.statementTransfer.findMany({
      where: {
        roundId,
        OR: parentFps.flatMap((fp) => [{ fingerprint: fp }, { fingerprint: { startsWith: `${fp}::split:` } }]),
      },
      select: { fingerprint: true, amount: true, accountNumber: true, description: true },
    });
    for (const { t, source } of sources) {
      if (source.kind !== "round") continue;
      const fp = source.parentFingerprint;
      const parent = family.find((f) => f.fingerprint === fp) ?? null;
      const rows = family.filter((f) => f.fingerprint === fp || f.fingerprint.startsWith(`${fp}::split:`));
      out.set(t.id, {
        payerName: parent ? unitOf(parent.description) : null,
        total: Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100,
        memberCount: rows.length,
        fromAccount: parent?.accountNumber || null,
      });
    }
  }
  return out;
}
