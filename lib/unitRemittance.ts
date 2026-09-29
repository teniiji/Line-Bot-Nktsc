import { isUnitPayerLine, splitSourceOf } from "./unitPayer";

// A unit's payroll office passing on what it deducted, as it reaches a round:
// either one member's share of a lump sum divided on the เงินเข้าประจำวัน
// page ("line:<line>#<member>" — lib/lineSplitStore.ts), or a unit's line put
// whole on one member from that page (a "line:" row naming no paying account,
// whose description reads like an office — lib/unitPayer.ts).
//
// The round also hears about the same deduction from the results file
// (ผลการหัก). A member it lists as หักได้ is that money already: the office
// took it from their pay and this is it arriving. A member it lists as
// หักไม่ได้ is the opposite — the office had nothing of theirs to send, so a
// share put on them is most likely a share that belongs to someone else.
export interface RemittanceCandidate {
  fingerprint: string;
  accountNumber: string;
  description: string | null;
}

export function isUnitRemittance(t: RemittanceCandidate): boolean {
  if (!t.fingerprint.startsWith("line:")) return false;
  if (splitSourceOf(t.fingerprint)?.kind === "line") return true;
  return !t.accountNumber && isUnitPayerLine(t.description);
}

// What units sent on for each member, over the rows the round still counts
// as payments (a row staff marked as being for something else is not one).
export function unitRemittanceByMember(
  transfers: (RemittanceCandidate & { memberNumber: string | null; amount: number; excludedReason: string | null })[]
): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of transfers) {
    if (!t.memberNumber || t.excludedReason || t.amount <= 0 || !isUnitRemittance(t)) continue;
    out.set(t.memberNumber, Math.round(((out.get(t.memberNumber) ?? 0) + t.amount) * 100) / 100);
  }
  return out;
}

// Where a unit's money and the results file meet on one member: "collected"
// is the same deduction heard twice (the unit's share is left out of what
// the member paid), "uncollected" is a share that probably is not theirs.
export function remittanceOverlap(m: {
  deductionResult: string;
  unitRemittance?: number;
}): "collected" | "uncollected" | null {
  if (!m.unitRemittance || m.unitRemittance <= 0) return null;
  if (m.deductionResult === "collected") return "collected";
  if (m.deductionResult === "uncollected") return "uncollected";
  return null;
}
