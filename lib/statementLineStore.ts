import { prisma } from "./prisma";
import { parseStatementLines, statementLineFingerprint } from "./statementLines";
import { planLineMerge, postedRange } from "./statementLineMerge";

export interface StoredStatement {
  // Lines the file carried, whether or not this upload wrote any of them.
  lines: number;
  // The days it covers, read from the file.
  from: Date | null;
  to: Date | null;
}

// Writes a statement's every line to StatementLine, merging with whatever the
// account already held for those same lines.
//
// Same shape as the round's own upload path: an export re-uploaded, or a wider
// date range covering an earlier one, refreshes the lines it carries and
// leaves every other line of that account alone.
//
// A line already stored keeps its row rather than being deleted and written
// again, because its id is what a staff-recorded transaction points at — see
// lib/statementLineMerge.ts for what breaks when it doesn't.
export async function storeStatementLines(
  rows: unknown[][],
  account: string,
  branch: string,
  sourceFile: string
): Promise<StoredStatement> {
  const lines = parseStatementLines(rows);
  const range = postedRange(lines);
  if (lines.length === 0) return { lines: 0, ...range };

  const data = lines.map((line) => ({
    account,
    branch,
    postedAt: line.postedAt,
    txnCode: line.txnCode,
    description: line.description,
    amount: line.amount,
    balance: line.balance,
    senderAccount: line.senderAccount,
    channel: line.channel,
    fingerprint: statementLineFingerprint(account, line),
    sourceFile,
  }));

  const stored = await prisma.statementLine.findMany({
    where: { account, fingerprint: { in: data.map((row) => row.fingerprint) } },
    select: {
      id: true,
      fingerprint: true,
      branch: true,
      description: true,
      senderAccount: true,
      channel: true,
    },
  });

  const plan = planLineMerge(stored, data);

  // One transaction, so a file either loads or doesn't. The updates are the
  // rare half — an ordinary re-upload plans none of them, because the file
  // says the same thing about those lines as it did the first time.
  await prisma.$transaction([
    prisma.statementLine.createMany({ data: plan.create }),
    ...plan.update.map(({ id, line }) =>
      prisma.statementLine.update({
        where: { id },
        data: {
          branch: line.branch,
          description: line.description,
          senderAccount: line.senderAccount,
          channel: line.channel,
        },
      })
    ),
  ]);

  return { lines: data.length, ...range };
}
