import { prisma } from "@/lib/prisma";
import { ownersFromRecordings, type RecordedOwner } from "@/lib/recordedOwners";

// What the daily page has been told about these accounts, read from the
// database.
//
// Shared by the round's own view and by the bulk bind behind it, because the
// two have to agree: the list is offered for approval by one and written by
// the other, and a second copy of this query is a second place for the answer
// to be worked out slightly differently. See lib/bulkBinding.ts.
//
// A recording carries the bank line it came from rather than the account, so
// the lines are looked up first and the payments joined back through them.
export async function recordedOwnersForAccounts(
  accounts: string[]
): Promise<Map<string, RecordedOwner>> {
  if (accounts.length === 0) return new Map();

  const payerLines = await prisma.statementLine.findMany({
    where: { senderAccount: { in: accounts } },
    select: { id: true, senderAccount: true },
  });
  if (payerLines.length === 0) return new Map();

  const recordings = await prisma.expense.findMany({
    where: {
      statementLineId: { in: payerLines.map((line) => line.id) },
      memberNumber: { not: null },
    },
    select: {
      statementLineId: true,
      memberNumber: true,
      memberFullName: true,
      category: true,
      createdAt: true,
    },
  });

  const accountOfLine = new Map(payerLines.map((line) => [line.id, line.senderAccount]));
  return ownersFromRecordings(
    recordings.map((row) => ({
      accountNumber: accountOfLine.get(row.statementLineId ?? "") ?? "",
      memberNumber: row.memberNumber as string,
      memberName: row.memberFullName,
      category: row.category,
      recordedAt: row.createdAt,
    }))
  );
}
