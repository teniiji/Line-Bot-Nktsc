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
    // Transfers staff have marked as being for something else (ซื้อหุ้น,
    // ชำระหนี้ …) are money that arrived but not money that settles a
    // deduction, so they must not count toward anyone's payment.
    prisma.statementTransfer.findMany({
      where: { roundId, memberNumber: { not: null }, excludedReason: null },
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

  // Only the accounts this round's transfers actually used need looking up,
  // so the directory can grow without this query growing with it.
  const directory = await prisma.memberBankAccount.findMany({
    where: { accountNumber: { in: [...new Set(transfers.map((t) => t.accountNumber))] } },
    select: { accountNumber: true, memberNumber: true },
  });

  // The directory is a fallback, not an override: it fills in accounts this
  // round's sheet says nothing about. Where the sheet does carry an account,
  // it is that round's own statement about who it belongs to and wins.
  const memberByAccount = new Map<string, string>();
  for (const entry of directory) memberByAccount.set(entry.accountNumber, entry.memberNumber);
  for (const member of members) {
    if (member.accountNumber) memberByAccount.set(member.accountNumber, member.memberNumber);
  }

  // A binding pointing at somebody who is not on this round's list would
  // credit a member with no row here — the money is real but belongs to
  // another round's reconciliation, so it stays unmatched and visible.
  const inRound = new Set(members.map((m) => m.memberNumber));

  await Promise.all(
    transfers
      .map((transfer) => {
        const found = memberByAccount.get(transfer.accountNumber) ?? null;
        const matched = found && inRound.has(found) ? found : null;
        if (matched === transfer.memberNumber) return null;
        return prisma.statementTransfer.update({
          where: { id: transfer.id },
          data: { memberNumber: matched },
        });
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
  );
}

// Re-reconciles every round whose statements contain this account, after its
// entry in the directory changed. Editing a binding to point at someone else,
// or deleting one, has to move the money on screen too — otherwise the change
// looks like it did nothing until some unrelated upload happens to trigger a
// rematch. Scoped to rounds that actually saw the account so this stays cheap
// however large the directory grows.
export async function rematchRoundsForAccount(accountNumber: string): Promise<number> {
  const affected = await prisma.statementTransfer.findMany({
    where: { accountNumber },
    select: { roundId: true },
    distinct: ["roundId"],
  });

  for (const { roundId } of affected) {
    await applyDirectoryAccounts(roundId);
    await rematchRoundTransfers(roundId);
    await recomputeRoundPayments(roundId);
  }
  return affected.length;
}

// Fills in the account number for members whose sheet left it blank, from the
// directory, when the directory knows exactly one account for them. With more
// than one there is nothing to choose between, so the column stays blank —
// their transfers still match through rematchRoundTransfers, this only keeps
// the "⛔ ไม่มีเลขบัญชี" bucket honest about who really cannot be matched.
export async function applyDirectoryAccounts(roundId: string): Promise<number> {
  // Values this function supplied earlier are handed back before it decides
  // again, so a binding that has since been corrected or deleted does not
  // leave its account number behind still matching. Sheet-supplied values are
  // never touched.
  await prisma.statementMember.updateMany({
    where: { roundId, accountSource: "directory" },
    data: { accountNumber: null, accountSource: null },
  });

  const blanks = await prisma.statementMember.findMany({
    where: { roundId, accountNumber: null },
    select: { id: true, memberNumber: true },
  });
  if (blanks.length === 0) return 0;

  const known = await prisma.memberBankAccount.findMany({
    where: { memberNumber: { in: blanks.map((m) => m.memberNumber) } },
    select: { memberNumber: true, accountNumber: true },
  });

  const accountsByMember = new Map<string, string[]>();
  for (const entry of known) {
    const list = accountsByMember.get(entry.memberNumber) ?? [];
    list.push(entry.accountNumber);
    accountsByMember.set(entry.memberNumber, list);
  }

  const updates = blanks
    .map((member) => {
      const accounts = accountsByMember.get(member.memberNumber);
      if (!accounts || accounts.length !== 1) return null;
      return prisma.statementMember.update({
        where: { id: member.id },
        data: { accountNumber: accounts[0], accountSource: "directory" },
      });
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  await Promise.all(updates);
  return updates.length;
}
