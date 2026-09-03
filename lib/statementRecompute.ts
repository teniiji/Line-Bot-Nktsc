import { prisma } from "@/lib/prisma";
import { calcPaymentStatus } from "@/lib/statementReconcile";

// Recomputes every member's payment total for a round from the transfer rows
// that are currently stored.
//
// Single source of truth on purpose: both uploads (a new member list, a new
// statement) change what the transfers add up to, and having each of them do
// its own incremental arithmetic is how totals drift. Rebuilding from the
// rows means the numbers on screen always match the transfers staff can
// click through to.
export async function recomputeRoundPayments(roundId: string): Promise<void> {
  const [members, transfers] = await Promise.all([
    prisma.statementMember.findMany({
      where: { roundId },
      select: { id: true, memberNumber: true, amountDue: true },
    }),
    prisma.statementTransfer.findMany({
      where: { roundId, memberNumber: { not: null } },
      select: { memberNumber: true, amount: true, transferredAt: true, branch: true },
    }),
  ]);

  const byMember = new Map<
    string,
    { amountPaid: number; paidAt: Date | null; branches: Set<string> }
  >();
  for (const transfer of transfers) {
    const key = transfer.memberNumber as string;
    const entry = byMember.get(key) ?? {
      amountPaid: 0,
      paidAt: null as Date | null,
      branches: new Set<string>(),
    };
    entry.amountPaid += transfer.amount;
    if (transfer.transferredAt && (!entry.paidAt || transfer.transferredAt > entry.paidAt)) {
      entry.paidAt = transfer.transferredAt;
    }
    entry.branches.add(transfer.branch);
    byMember.set(key, entry);
  }

  await Promise.all(
    members.map((member) => {
      const paid = byMember.get(member.memberNumber);
      const amountPaid = paid?.amountPaid ?? 0;
      return prisma.statementMember.update({
        where: { id: member.id },
        data: {
          amountPaid,
          paidAt: paid?.paidAt ?? null,
          // Someone who paid into both accounts gets both named rather than
          // an arbitrary one of the two.
          paidBranch: paid ? Array.from(paid.branches).sort().join(" + ") : null,
          status: calcPaymentStatus(amountPaid, member.amountDue).status,
        },
      });
    })
  );
}

// Re-points transfers at members after the member list changes: an account
// number that now belongs to someone (or no longer does) has to be reflected
// before totals are recomputed.
export async function rematchRoundTransfers(roundId: string): Promise<void> {
  const [members, transfers] = await Promise.all([
    prisma.statementMember.findMany({
      where: { roundId },
      select: { memberNumber: true, accountNumber: true },
    }),
    prisma.statementTransfer.findMany({
      where: { roundId },
      select: { id: true, accountNumber: true, memberNumber: true },
    }),
  ]);

  const memberByAccount = new Map<string, string>();
  for (const member of members) {
    if (member.accountNumber) memberByAccount.set(member.accountNumber, member.memberNumber);
  }

  await Promise.all(
    transfers
      .map((transfer) => {
        const matched = memberByAccount.get(transfer.accountNumber) ?? null;
        if (matched === transfer.memberNumber) return null;
        return prisma.statementTransfer.update({
          where: { id: transfer.id },
          data: { memberNumber: matched },
        });
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
  );
}
