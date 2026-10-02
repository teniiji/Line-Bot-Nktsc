import { prisma } from "@/lib/prisma";
import { pairStandIns } from "@/lib/bridgeDedupe";
import { syncTransferCarried } from "@/lib/carriedDebtStore";
import { OTHER_ROUND_REASON } from "@/lib/statementSlipHints";

// Database side of lib/bridgeDedupe.ts: removes the second copy of each
// bank line a round holds twice, keeping one row and everything staff said
// on either — whose money it is, what it was for, and any part of it that
// paid a carried debt. Returns how many were folded; the caller recomputes.
//
// The stand-in is the one kept. It is staff saying whose payment this is,
// which the round reads as more than a transfer (a member still on รอผลการหัก
// is judged against what was asked — see recomputeRoundPayments), and the
// carried payments and dismissals made from it are keyed by its fingerprint.
// The file's copy comes back on the next upload of the same export and is
// folded again. The exception is a file row staff already worked on by hand
// (moved it, or split part of it off): that row is their latest word, and the
// stand-in goes instead.
export async function absorbCoveredStandIns(roundId: string): Promise<number> {
  const select = {
    id: true,
    fingerprint: true,
    accountNumber: true,
    amount: true,
    transferredAt: true,
    memberNumber: true,
    manualMemberNumber: true,
    excludedReason: true,
  } as const;
  const bridges = await prisma.statementTransfer.findMany({
    where: { roundId, manualMemberNumber: true, fingerprint: { startsWith: "line:" } },
    select,
  });
  const accounts = [...new Set(bridges.map((b) => b.accountNumber).filter(Boolean))];
  if (accounts.length === 0) return 0;
  const uploaded = await prisma.statementTransfer.findMany({
    where: { roundId, accountNumber: { in: accounts }, NOT: { fingerprint: { startsWith: "line:" } } },
    select,
  });

  // A row part of which was cut out ("ตัดยอดออก") or split off to another
  // member holds less than the bank line; the line's own amount is the row
  // plus its pieces, and that is what the other copy carries.
  const pieces = await prisma.statementTransfer.findMany({
    where: {
      roundId,
      OR: [...bridges, ...uploaded].map((r) => ({ fingerprint: { startsWith: `${r.fingerprint}::` } })),
    },
    select: { fingerprint: true, amount: true },
  });
  const whole = <T extends { fingerprint: string; amount: number }>(row: T): T => ({
    ...row,
    amount:
      Math.round(
        (row.amount +
          pieces
            .filter((p) => p.fingerprint.startsWith(`${row.fingerprint}::`))
            .reduce((sum, p) => sum + p.amount, 0)) *
          100
      ) / 100,
  });
  const pairs = pairStandIns(bridges.map(whole), uploaded.map(whole));
  for (const { bridge, real } of pairs) {
    const [keep, drop] = real.manualMemberNumber ? [real, bridge] : [bridge, real];
    if (drop.excludedReason && !keep.excludedReason) {
      await prisma.statementTransfer.update({
        where: { id: keep.id },
        data: { excludedReason: drop.excludedReason },
      });
    }
    await prisma.carriedDebtPayment.updateMany({
      where: { roundId, fingerprint: drop.fingerprint },
      data: { fingerprint: keep.fingerprint },
    });
    await prisma.statementTransfer.delete({ where: { id: drop.id } });
    await syncTransferCarried(roundId, keep.fingerprint);
  }
  return pairs.length;
}

// The same, across rounds. Staff can now count a daily line in an earlier
// round than the month it arrived in (30047: October money for September —
// see the record route's target, and ➕ นับเข้ารอบนี้ on other-month
// recordings). When October's statement is uploaded afterwards, its copy of
// that line lands in October under the bank's own fingerprint, counting the
// same money a second time — and the two rounds' fingerprints differ, so
// neither absorbCoveredStandIns above nor the round's "counted elsewhere"
// check sees it.
//
// The stand-in in the other round is staff saying which month the money
// paid, so it stays; this round's copy is set aside as ชำระของรอบอื่น, the
// reason staff would pick by hand, and stays visible here with it. Returns
// how many were set aside; the caller recomputes.
//
// Only rows this upload has just brought in: once a row has been here, what
// it counts for is staff's to say, and putting it back to "นับเป็นจ่ายค่าหัก
// ไม่ได้" must not be undone by the next upload of the same export.
export async function setAsideCountedInOtherRound(roundId: string, newFingerprints: string[]): Promise<number> {
  if (newFingerprints.length === 0) return 0;
  const select = {
    id: true,
    fingerprint: true,
    accountNumber: true,
    amount: true,
    transferredAt: true,
    memberNumber: true,
    manualMemberNumber: true,
    excludedReason: true,
  } as const;
  const uploaded = await prisma.statementTransfer.findMany({
    where: { roundId, excludedReason: null, fingerprint: { in: newFingerprints } },
    select,
  });
  const accounts = [...new Set(uploaded.map((u) => u.accountNumber).filter(Boolean))];
  if (accounts.length === 0) return 0;
  const elsewhere = await prisma.statementTransfer.findMany({
    where: {
      roundId: { not: roundId },
      manualMemberNumber: true,
      excludedReason: null,
      fingerprint: { startsWith: "line:" },
      accountNumber: { in: accounts },
    },
    select,
  });
  const pairs = pairStandIns(elsewhere, uploaded);
  for (const { real } of pairs) {
    await prisma.statementTransfer.update({
      where: { id: real.id },
      // "staff": the choice of month was a person's, and the slip rules in
      // recomputeRoundPayments leave a person's reason alone.
      data: { excludedReason: OTHER_ROUND_REASON, reasonSource: "staff" },
    });
  }
  return pairs.length;
}
