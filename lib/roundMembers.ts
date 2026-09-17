import { prisma } from "@/lib/prisma";
import type { UploadPlan } from "@/lib/deductionUpload";
import {
  applyDirectoryAccounts,
  recomputeRoundPayments,
  rematchRoundTransfers,
} from "@/lib/statementRecompute";

// Writing an upload plan into a round, and saying where the round now stands.
//
// Shared by the two uploads — the รายการหัก that starts a round and the
// results that fill it in — because after either of them the round has to be
// re-reconciled the same way: accounts filled from the directory, transfers
// re-matched, totals rebuilt. See lib/deductionUpload.ts for the plan itself.

export async function applyRoundSheet(roundId: string, plan: UploadPlan): Promise<void> {
  if (plan.create.length > 0) {
    await prisma.statementMember.createMany({
      data: plan.create.map((row) => ({
        roundId,
        memberNumber: row.memberNumber,
        name: row.name,
        unitName: row.unitName,
        hCode: row.hCode,
        note: row.note,
        accountNumber: row.accountNumber,
        expectedAmount: row.expectedAmount,
        deductionResult: row.result,
        amountDue: row.amountDue,
      })),
      skipDuplicates: true,
    });
  }

  for (const row of plan.update) {
    await prisma.statementMember.update({
      where: { roundId_memberNumber: { roundId, memberNumber: row.memberNumber } },
      data: {
        // Only what this sheet actually carries. A column the file does not
        // have — or one left unmapped on purpose, which is how a unit's file
        // avoids overwriting the round's own หน่วยคุม coding with its
        // internal one — says nothing, and nothing is not an instruction to
        // erase what another file already established.
        ...(row.name ? { name: row.name } : {}),
        ...(row.unitName ? { unitName: row.unitName } : {}),
        ...(row.hCode ? { hCode: row.hCode } : {}),
        ...(row.note ? { note: row.note } : {}),
        ...(row.expectedAmount !== null ? { expectedAmount: row.expectedAmount } : {}),
        deductionResult: row.result,
        amountDue: row.amountDue,
        // A sheet that carries an account number is the round's own statement
        // about it and wins; one that leaves it blank says nothing, so a
        // binding made by hand or filled from the directory survives.
        ...(row.accountNumber
          ? { accountNumber: row.accountNumber, accountSource: "sheet" }
          : {}),
      },
    });
  }

  // Members the sheet left without an account number may already be known to
  // the directory from an earlier round, so the work of binding accounts is
  // not repeated every month. Then the transfers already read out of
  // statements are re-matched against the list as it now stands.
  await applyDirectoryAccounts(roundId);
  await rematchRoundTransfers(roundId);
  await recomputeRoundPayments(roundId);
}

export interface RoundProgress {
  members: number;
  awaiting: number;
  collected: number;
  uncollected: number;
  awaitingAmount: number;
  // Units are counted by หน่วยคุม (H-code) where there is one, which is how
  // the cooperative's own summary sheet is organised. A unit counts as having
  // reported when none of its members is still awaiting.
  units: number;
  unitsReported: number;
  unitsAwaiting: string[];
}

// Recounts where the round stands from the member rows themselves, and
// records it on the round so the page can say it without counting 1,173 rows
// in the browser. Called after every upload.
export async function refreshRoundProgress(roundId: string): Promise<RoundProgress> {
  const members = await prisma.statementMember.findMany({
    where: { roundId },
    select: {
      memberNumber: true,
      unitName: true,
      hCode: true,
      deductionResult: true,
      expectedAmount: true,
    },
  });

  const byUnit = new Map<string, { total: number; awaiting: number }>();
  let awaiting = 0;
  let collected = 0;
  let uncollected = 0;
  let awaitingAmount = 0;

  for (const member of members) {
    if (member.deductionResult === "awaiting") {
      awaiting += 1;
      awaitingAmount += member.expectedAmount ?? 0;
    } else if (member.deductionResult === "collected") collected += 1;
    else uncollected += 1;

    const key = member.hCode ?? member.unitName;
    if (!key) continue;
    const entry = byUnit.get(key) ?? { total: 0, awaiting: 0 };
    entry.total += 1;
    if (member.deductionResult === "awaiting") entry.awaiting += 1;
    byUnit.set(key, entry);
  }

  const unitsAwaiting = [...byUnit]
    .filter(([, counts]) => counts.awaiting > 0)
    .map(([unit]) => unit)
    .sort((a, b) => a.localeCompare(b, "th"));

  const progress: RoundProgress = {
    members: members.length,
    awaiting,
    collected,
    uncollected,
    awaitingAmount: Math.round(awaitingAmount * 100) / 100,
    units: byUnit.size,
    unitsReported: byUnit.size - unitsAwaiting.length,
    unitsAwaiting,
  };

  await prisma.statementRound.update({
    where: { id: roundId },
    data: {
      awaitingUnits: unitsAwaiting.length,
      awaitingMembers: awaiting,
      awaitingAmount: progress.awaitingAmount,
    },
  });

  return progress;
}
