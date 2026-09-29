import { prisma } from "@/lib/prisma";
import { memberNumberKey } from "@/lib/memberNumber";
import { DEDUCTION_CATEGORY } from "@/lib/statementSlipHints";
import { recomputeRoundPayments } from "@/lib/statementRecompute";
import { bridgeLineToRound } from "@/lib/lineBridgeStore";
import { rememberUnitMember } from "@/lib/unitPayerStore";
import { isUnitPayerLine, payerKey } from "@/lib/unitPayer";
import { learnedFromLine, reassignProblem } from "@/lib/lineReassign";

export class ReassignError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export async function reassignRecording(lineId: string, rawMember: string, statedName: string | null) {
  const line = await prisma.statementLine.findUnique({ where: { id: lineId } });
  const recording = line ? await prisma.expense.findUnique({ where: { statementLineId: line.id } }) : null;
  if (!line || !recording) throw new ReassignError("ไม่พบรายการที่บันทึกจากบรรทัดนี้", 404);

  const toMember = memberNumberKey(rawMember) ?? "";
  const bridge = `line:${line.fingerprint}`;
  const rows = await prisma.statementTransfer.findMany({
    where: { account: line.account, OR: [{ fingerprint: bridge }, { fingerprint: { startsWith: `${bridge}::` } }] },
    select: { id: true, roundId: true, fingerprint: true, carriedAmount: true },
  });
  const carriedPayments = await prisma.carriedDebtPayment.count({ where: { fingerprint: bridge } });
  const roundIds = [...new Set(rows.map((r) => r.roundId))];
  const closed = roundIds.length
    ? await prisma.statementRound.findFirst({ where: { id: { in: roundIds }, closedAt: { not: null } }, select: { label: true } })
    : null;
  const problem = reassignProblem({
    fromMember: memberNumberKey(recording.memberNumber ?? "") ?? recording.memberNumber,
    toMember,
    pieces: rows.filter((r) => r.fingerprint !== bridge).length,
    carried: carriedPayments > 0 || rows.some((r) => r.carriedAmount > 0.005),
    closedRound: closed?.label ?? null,
  });
  if (problem) throw new ReassignError(problem, 400);

  const roster = await prisma.memberRoster.findUnique({
    where: { memberNumber: toMember },
    select: { memberName: true },
  });
  const person = {
    memberNumber: toMember,
    memberFullName: roster?.memberName ?? statedName,
    memberVerified: roster !== null,
  };
  const fromMember = recording.memberNumber;
  await prisma.$transaction([
    // The recording and anything set aside from it (สสค …) are the member's.
    prisma.expense.update({ where: { id: recording.id }, data: person }),
    prisma.expense.updateMany({ where: { asideFromLineId: line.id }, data: person }),
    // Off the wrong member's round row; put back below where the new member
    // owes.
    prisma.statementTransfer.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }),
  ]);
  for (const roundId of roundIds) await recomputeRoundPayments(roundId);

  // A unit's line taught the unit it pays for the wrong member; unlearn
  // that, and learn the right one.
  if (!line.senderAccount && isUnitPayerLine(line.description)) {
    const key = payerKey(line.description);
    const payer = key ? await prisma.unitPayer.findUnique({ where: { key } }) : null;
    if (payer && fromMember) {
      const entry = await prisma.unitPayerMember.findUnique({
        where: { payerId_memberNumber: { payerId: payer.id, memberNumber: fromMember } },
      });
      if (entry && learnedFromLine(entry, line.amount)) {
        await prisma.unitPayerMember.delete({ where: { id: entry.id } });
      }
    }
    await rememberUnitMember(line.description, toMember, line.amount);
  }

  let round: { period: string; label: string } | null = null;
  let notCounted: string | null = null;
  if (recording.category === DEDUCTION_CATEGORY) {
    const outcome = await bridgeLineToRound(line, toMember, recording.amount);
    if (outcome.bridged) round = { period: outcome.round.period, label: outcome.round.label };
    else notCounted = outcome.reason;
  }
  return { from: fromMember, to: toMember, name: person.memberFullName, round, notCounted };
}
