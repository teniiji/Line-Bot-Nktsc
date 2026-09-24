import { prisma } from "@/lib/prisma";
import { calcPaymentStatus } from "@/lib/statementReconcile";
import { fillAccounts } from "@/lib/accountHistory";

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
      select: { id: true, memberNumber: true, amountDue: true, deductionResult: true },
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
          // Nobody has said yet whether payroll could deduct from this
          // member, so they are not short of anything — and calling a row
          // with nothing due "✅ ชำระครบ" would put a whole unit that has not
          // even replied among the people who have settled.
          //
          // A member payroll did deduct from is "collected" for the same
          // reason: they owe this round nothing, and counting them among
          // ✅ ชำระครบ would read as a thousand people having transferred
          // money they were never asked for.
          status:
            member.deductionResult === "awaiting"
              ? "awaiting"
              : member.deductionResult === "collected"
                ? "collected"
                : calcPaymentStatus(amountPaid, member.amountDue).status,
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
    // manualMemberNumber excluded from the where clause on purpose: those
    // rows are still read here (so the loop below can skip them by id) but
    // are never candidates for a rewrite — see the filter after the map.
    prisma.statementTransfer.findMany({
      where: { roundId },
      select: { id: true, accountNumber: true, memberNumber: true, manualMemberNumber: true },
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
        // Staff already said whose this is — an account-number rematch
        // would otherwise put it straight back to the account holder on the
        // next statement upload, undoing the correction it exists for.
        if (transfer.manualMemberNumber) return null;
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

// The same thing after a bulk import, where calling the single-account
// version per row would re-reconcile the same round thousands of times. The
// rounds are collected first and each is recomputed once.
export async function rematchRoundsForAccounts(accountNumbers: string[]): Promise<number> {
  if (accountNumbers.length === 0) return 0;

  // Postgres has a limit on bound parameters, and an import can carry the
  // whole cooperative, so the lookup is chunked rather than sent as one
  // enormous IN list.
  const CHUNK = 1000;
  const roundIds = new Set<string>();
  for (let i = 0; i < accountNumbers.length; i += CHUNK) {
    const found = await prisma.statementTransfer.findMany({
      where: { accountNumber: { in: accountNumbers.slice(i, i + CHUNK) } },
      select: { roundId: true },
      distinct: ["roundId"],
    });
    for (const { roundId } of found) roundIds.add(roundId);
  }

  for (const roundId of roundIds) {
    await applyDirectoryAccounts(roundId);
    await rematchRoundTransfers(roundId);
    await recomputeRoundPayments(roundId);
  }
  return roundIds.size;
}

// Fills in the account number for members whose sheet left it blank, from
// the directory and then from the last round that carried one — see
// lib/accountHistory.ts for why the second source exists at all: a sheet's
// เลขบัญชี column never reached the directory, so every account the
// cooperative learned that way was invisible to the next month's round.
//
// With more than one account and nothing to choose between them the column
// stays blank on purpose. Their transfers still match through
// rematchRoundTransfers; this keeps the "⛔ ไม่มีเลขบัญชี" bucket honest
// about who really cannot be matched.
export interface AccountFillResult {
  fromDirectory: number;
  // Filled from an earlier round's own sheet — knowledge the cooperative had
  // and the round could not see. See lib/accountHistory.ts.
  fromPrevious: number;
  // More than one account on offer with nothing to choose between them.
  ambiguous: number;
}

export async function applyDirectoryAccounts(roundId: string): Promise<AccountFillResult> {
  // Values this function supplied earlier are handed back before it decides
  // again, so a binding that has since been corrected or deleted does not
  // leave its account number behind still matching. Sheet-supplied values are
  // never touched.
  await prisma.statementMember.updateMany({
    where: { roundId, accountSource: { in: ["directory", "previous"] } },
    data: { accountNumber: null, accountSource: null },
  });

  const blanks = await prisma.statementMember.findMany({
    where: { roundId, accountNumber: null },
    select: { id: true, memberNumber: true },
  });
  if (blanks.length === 0) return { fromDirectory: 0, fromPrevious: 0, ambiguous: 0 };

  // A round runs to thousands of members now that it starts from the
  // รายการหัก, and Postgres has a limit on bound parameters, so the lookups
  // go in chunks rather than as one enormous IN list.
  const CHUNK = 1000;
  const numbers = [...new Set(blanks.map((m) => m.memberNumber))];
  const known: { memberNumber: string; accountNumber: string }[] = [];
  const historic: { memberNumber: string; accountNumber: string; roundId: string }[] = [];
  for (let i = 0; i < numbers.length; i += CHUNK) {
    const slice = numbers.slice(i, i + CHUNK);
    known.push(
      ...(await prisma.memberBankAccount.findMany({
        where: { memberNumber: { in: slice } },
        select: { memberNumber: true, accountNumber: true },
      }))
    );
    const rows = await prisma.statementMember.findMany({
      where: { memberNumber: { in: slice }, roundId: { not: roundId }, accountNumber: { not: null } },
      select: { memberNumber: true, accountNumber: true, roundId: true },
    });
    for (const row of rows) {
      historic.push({
        memberNumber: row.memberNumber,
        accountNumber: row.accountNumber as string,
        roundId: row.roundId,
      });
    }
  }

  // Rounds in the cooperative's own order, so "the most recent round that
  // knew one" means the most recent month rather than whichever row the
  // database returned first.
  const rounds = await prisma.statementRound.findMany({
    where: { id: { in: [...new Set(historic.map((row) => row.roundId))] } },
    select: { id: true, period: true },
    orderBy: { period: "asc" },
  });
  const rankOf = new Map(rounds.map((round, index) => [round.id, index]));

  const { fills, ambiguous } = fillAccounts(
    numbers,
    known,
    historic.map((row) => ({
      memberNumber: row.memberNumber,
      accountNumber: row.accountNumber,
      rank: rankOf.get(row.roundId) ?? -1,
    }))
  );

  const fillByMember = new Map(fills.map((fill) => [fill.memberNumber, fill]));
  const updates = blanks
    .map((member) => {
      const fill = fillByMember.get(member.memberNumber);
      if (!fill) return null;
      return prisma.statementMember.update({
        where: { id: member.id },
        data: { accountNumber: fill.accountNumber, accountSource: fill.source },
      });
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  await Promise.all(updates);

  return {
    fromDirectory: fills.filter((fill) => fill.source === "directory").length,
    fromPrevious: fills.filter((fill) => fill.source === "previous").length,
    ambiguous: ambiguous.length,
  };
}
