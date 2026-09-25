import { prisma } from "@/lib/prisma";
import { normalizeAccountNumber } from "@/lib/statementReconcile";
import { parseDeductionPeriod, periodOfDate } from "@/lib/deductionPeriod";
import { isMemberDeposit } from "@/lib/statementLines";
import { coveredByRealTransfer } from "@/lib/roundReach";
import { LINE_FINGERPRINT_PREFIX } from "@/lib/carriedDebt";
import type {
  DailyLine,
  MonthStanding,
  OpenDebt,
  RoundStanding,
  RoundTransfer,
} from "@/lib/carriedDebtCandidates";

// Database side of lib/carriedDebtCandidates.ts.

const CHUNK = 1000;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

export interface CandidateTransferRow extends RoundTransfer {
  roundLabel: string;
  sourceFile: string | null;
}

// A debtor's bank line that no round holds — only the เงินเข้าประจำวัน page
// has it. What a round never received it cannot count, so the line can pay a
// carried debt directly; see lib/carriedDebtStore.ts adoptLinePayments for
// what happens if a round receives it later.
export interface DailyLineRow extends DailyLine {
  account: string;
  amount: number;
  sourceFile: string | null;
}

export interface CandidateInputs {
  debts: OpenDebt[];
  transfers: CandidateTransferRow[];
  standings: RoundStanding[];
  lines: DailyLineRow[];
  monthStandings: MonthStanding[];
}

export async function loadCandidateInputs(debtIds?: string[]): Promise<CandidateInputs> {
  const rows = await prisma.carriedDebt.findMany({
    where: { status: "unpaid", ...(debtIds ? { id: { in: debtIds } } : {}) },
  });
  if (rows.length === 0) {
    return { debts: [], transfers: [], standings: [], lines: [], monthStandings: [] };
  }

  const numbers = [...new Set(rows.map((d) => d.memberNumber))];
  const bound: { memberNumber: string; accountNumber: string }[] = [];
  for (const slice of chunks(numbers)) {
    bound.push(
      ...(await prisma.memberBankAccount.findMany({
        where: { memberNumber: { in: slice } },
        select: { memberNumber: true, accountNumber: true },
      }))
    );
  }
  const accountsOf = new Map<string, Set<string>>();
  const add = (member: string, account: string | null) => {
    const normalized = normalizeAccountNumber(account);
    if (!normalized) return;
    const set = accountsOf.get(member) ?? new Set<string>();
    set.add(normalized);
    accountsOf.set(member, set);
  };
  for (const row of rows) add(row.memberNumber, row.accountNumber);
  for (const row of bound) add(row.memberNumber, row.accountNumber);

  // Where each debt's month begins, so a daily line from before it is not
  // offered as a payment toward it.
  const sourceRounds = await prisma.statementRound.findMany({
    where: { id: { in: [...new Set(rows.map((d) => d.sourceRoundId))] } },
    select: { id: true, period: true },
  });
  const startOf = new Map<string, Date | null>();
  for (const round of sourceRounds) {
    const parsed = parseDeductionPeriod(round.period);
    startOf.set(round.id, parsed ? new Date(Date.UTC(parsed.year - 543, parsed.month - 1, 1)) : null);
  }

  const debts: OpenDebt[] = rows.map((row) => ({
    id: row.id,
    memberNumber: row.memberNumber,
    outstanding: Math.max(0, Math.round((row.amount - row.amountPaid) * 100) / 100),
    accounts: [...(accountsOf.get(row.memberNumber) ?? [])],
    since: startOf.get(row.sourceRoundId) ?? null,
  }));
  const accounts = [...new Set(debts.flatMap((d) => d.accounts))];

  // Every transfer from those accounts or already counted for those members,
  // in any round — excluded ones too, because they still say the bank line is
  // in a round when judging which daily lines no round holds.
  const found = new Map<string, Awaited<ReturnType<typeof prisma.statementTransfer.findMany>>[number]>();
  for (const slice of chunks(accounts)) {
    for (const t of await prisma.statementTransfer.findMany({ where: { accountNumber: { in: slice } } })) {
      found.set(t.id, t);
    }
  }
  for (const slice of chunks(numbers)) {
    for (const t of await prisma.statementTransfer.findMany({ where: { memberNumber: { in: slice } } })) {
      found.set(t.id, t);
    }
  }
  const all = [...found.values()];

  const rounds = await prisma.statementRound.findMany({
    where: { id: { in: [...new Set(all.map((t) => t.roundId))] } },
    select: { id: true, label: true, closedAt: true },
  });
  const roundOf = new Map(rounds.map((r) => [r.id, r]));

  const transfers: CandidateTransferRow[] = all
    .filter((t) => roundOf.has(t.roundId))
    .map((t) => ({
      id: t.id,
      roundId: t.roundId,
      roundClosed: !!roundOf.get(t.roundId)?.closedAt,
      roundLabel: roundOf.get(t.roundId)?.label ?? "",
      memberNumber: t.memberNumber,
      accountNumber: t.accountNumber,
      amount: t.amount,
      carriedAmount: t.carriedAmount,
      excludedReason: t.excludedReason,
      transferredAt: t.transferredAt,
      sourceFile: t.sourceFile,
    }));

  const memberNumbersInRounds = [
    ...new Set(transfers.map((t) => t.memberNumber).filter(Boolean)),
  ] as string[];
  const standings: RoundStanding[] = [];
  for (const slice of chunks(memberNumbersInRounds)) {
    standings.push(
      ...(await prisma.statementMember.findMany({
        where: {
          roundId: { in: [...new Set(transfers.map((t) => t.roundId))] },
          memberNumber: { in: slice },
        },
        select: {
          roundId: true,
          memberNumber: true,
          deductionResult: true,
          amountDue: true,
          amountPaid: true,
        },
      }))
    );
  }

  // Daily lines from the same accounts that no round holds.
  const rawLines: Awaited<ReturnType<typeof prisma.statementLine.findMany>> = [];
  for (const slice of chunks(accounts)) {
    rawLines.push(
      ...(await prisma.statementLine.findMany({
        where: { senderAccount: { in: slice }, amount: { gt: 0 } },
      }))
    );
  }
  const inRounds = all.map((t) => ({
    accountNumber: t.accountNumber,
    amount: t.amount,
    transferredAt: t.transferredAt,
  }));
  const loose = rawLines.filter(
    (line) =>
      isMemberDeposit(line.channel) &&
      line.senderAccount &&
      !(line.postedAt && coveredByRealTransfer(inRounds, line.senderAccount, line.amount, line.postedAt))
  );

  // What of each already went to carried debts.
  const used = new Map<string, number>();
  for (const slice of chunks(loose.map((l) => `${LINE_FINGERPRINT_PREFIX}${l.fingerprint}`))) {
    const grouped = await prisma.carriedDebtPayment.groupBy({
      by: ["fingerprint"],
      where: { roundId: null, fingerprint: { in: slice } },
      _sum: { amount: true },
    });
    for (const row of grouped) {
      if (row.fingerprint) used.set(row.fingerprint, row._sum.amount ?? 0);
    }
  }
  const lines: DailyLineRow[] = loose.map((line) => ({
    id: line.id,
    senderAccount: line.senderAccount as string,
    available:
      Math.round(
        (line.amount - (used.get(`${LINE_FINGERPRINT_PREFIX}${line.fingerprint}`) ?? 0)) * 100
      ) / 100,
    postedAt: line.postedAt,
    account: line.account,
    amount: line.amount,
    sourceFile: line.sourceFile,
  }));

  // How the debtors stand on the open round for each line's own month.
  const periods = [
    ...new Set(lines.filter((l) => l.postedAt).map((l) => periodOfDate(l.postedAt as Date))),
  ];
  const monthRounds = periods.length
    ? await prisma.statementRound.findMany({
        where: { period: { in: periods }, closedAt: null },
        select: { id: true, period: true },
      })
    : [];
  const periodOfRound = new Map(monthRounds.map((r) => [r.id, r.period]));
  const monthStandings: MonthStanding[] = [];
  if (monthRounds.length) {
    for (const slice of chunks(numbers)) {
      const rowsInMonth = await prisma.statementMember.findMany({
        where: { roundId: { in: monthRounds.map((r) => r.id) }, memberNumber: { in: slice } },
        select: { roundId: true, memberNumber: true, deductionResult: true, status: true },
      });
      for (const row of rowsInMonth) {
        monthStandings.push({
          period: periodOfRound.get(row.roundId) as string,
          memberNumber: row.memberNumber,
          deductionResult: row.deductionResult,
          status: row.status,
        });
      }
    }
  }

  return { debts, transfers, standings, lines, monthStandings };
}
