import { prisma } from "@/lib/prisma";
import { normalizeAccountNumber } from "@/lib/statementReconcile";
import { parseDeductionPeriod } from "@/lib/deductionPeriod";
import { isMemberDeposit } from "@/lib/statementLines";
import { coveredByRealTransfer } from "@/lib/roundReach";
import type { OpenDebt, RoundStanding, RoundTransfer } from "@/lib/carriedDebtCandidates";

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

// A bank line that came from a debtor's account but sits in no round at all —
// only on the เงินเข้าประจำวัน page, which cannot pay anything. Shown so staff
// know the money is there and which month's statement still has to go into a
// round.
export interface DailyOnlyLine {
  debtId: string;
  lineId: string;
  account: string;
  postedAt: Date | null;
  amount: number;
  senderAccount: string;
}

export interface CandidateInputs {
  debts: OpenDebt[];
  transfers: CandidateTransferRow[];
  standings: RoundStanding[];
  dailyOnly: DailyOnlyLine[];
}

export async function loadCandidateInputs(debtIds?: string[]): Promise<CandidateInputs> {
  const rows = await prisma.carriedDebt.findMany({
    where: { status: "unpaid", ...(debtIds ? { id: { in: debtIds } } : {}) },
  });
  if (rows.length === 0) return { debts: [], transfers: [], standings: [], dailyOnly: [] };

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

  const debts: OpenDebt[] = rows.map((row) => ({
    id: row.id,
    memberNumber: row.memberNumber,
    outstanding: Math.max(0, Math.round((row.amount - row.amountPaid) * 100) / 100),
    accounts: [...(accountsOf.get(row.memberNumber) ?? [])],
  }));
  const accounts = [...new Set(debts.flatMap((d) => d.accounts))];

  // Every transfer from those accounts or already counted for those members,
  // in any round — excluded ones too, because they still say the bank line is
  // in a round when judging what is only on the daily page.
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

  // Lines on the daily page from the same accounts that no round holds.
  // Only from the first day of the debt's own month: anything earlier is an
  // older month's business.
  const sourceRounds = await prisma.statementRound.findMany({
    where: { id: { in: [...new Set(rows.map((d) => d.sourceRoundId))] } },
    select: { id: true, period: true },
  });
  const startOf = new Map<string, Date | null>();
  for (const round of sourceRounds) {
    const parsed = parseDeductionPeriod(round.period);
    startOf.set(round.id, parsed ? new Date(Date.UTC(parsed.year - 543, parsed.month - 1, 1)) : null);
  }
  const lines: Awaited<ReturnType<typeof prisma.statementLine.findMany>> = [];
  for (const slice of chunks(accounts)) {
    lines.push(
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
  const dailyOnly: DailyOnlyLine[] = [];
  for (const line of lines) {
    if (!isMemberDeposit(line.channel) || !line.senderAccount) continue;
    if (line.postedAt && coveredByRealTransfer(inRounds, line.senderAccount, line.amount, line.postedAt)) {
      continue;
    }
    for (const row of rows) {
      if (!accountsOf.get(row.memberNumber)?.has(line.senderAccount)) continue;
      const start = startOf.get(row.sourceRoundId);
      if (start && line.postedAt && line.postedAt < start) continue;
      dailyOnly.push({
        debtId: row.id,
        lineId: line.id,
        account: line.account,
        postedAt: line.postedAt,
        amount: line.amount,
        senderAccount: line.senderAccount,
      });
    }
  }

  return { debts, transfers, standings, dailyOnly };
}
