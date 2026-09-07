import { prisma } from "./prisma";
import { parseStatementLines, statementLineFingerprint } from "./statementLines";

// Writes a statement's every line to StatementLine, replacing whatever the
// account already held for those same lines.
//
// Same shape as the round's own upload path: an export re-uploaded, or a wider
// date range covering an earlier one, refreshes the lines it carries and
// leaves every other line of that account alone. Nothing here is staff-edited,
// so unlike the round there is nothing to carry across the replacement.
export async function storeStatementLines(
  rows: unknown[][],
  account: string,
  branch: string,
  sourceFile: string
): Promise<number> {
  const lines = parseStatementLines(rows);
  if (lines.length === 0) return 0;

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

  await prisma.$transaction([
    prisma.statementLine.deleteMany({
      where: { account, fingerprint: { in: data.map((row) => row.fingerprint) } },
    }),
    prisma.statementLine.createMany({ data }),
  ]);

  return data.length;
}
