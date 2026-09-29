// Moving part — or all — of one transfer's credit to a different member.
//
// A statement line is one payment; it is not always one person's. Somebody
// transfers on a relative's behalf, or sends a single lump sum that happens
// to cover two members' เก็บไม่ได้ at once. Until now the only lever on a
// transfer was excludedReason, and that only ever takes money *out* of the
// round's count — there was no way to say "this belongs to somebody else
// instead", so the second member's debt kept reading as unpaid no matter
// what staff did to the first member's row.
//
// A split is two decisions in one: how much of this transfer actually
// belongs to the other member (up to the whole amount, when the transfer
// was never partly this account holder's to begin with), and who that member
// is. What is left behind, if anything, stays exactly what it was — still
// the original account's own payment, matched the ordinary way.

// Two amounts are the same payment once they are within a satang of each
// other — the same tolerance used everywhere else money is compared in this
// codebase (see lib/deductionMatch.ts).
const EPSILON = 0.01;

/**
 * Why a split cannot proceed, or null when it can. Checked against the
 * transfer's own amount — never against what a person merely typed, since a
 * split that quietly moved more money than the transfer carried would create
 * money the statement never reported.
 */
export function splitAmountProblem(transferAmount: number, amount: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) {
    return "จำนวนเงินที่จะย้ายต้องมากกว่า 0";
  }
  if (amount > transferAmount + EPSILON) {
    return `ย้ายได้ไม่เกินยอดของรายการนี้ (${transferAmount.toFixed(2)} บาท)`;
  }
  return null;
}

/**
 * Whether this split takes the transfer's entire amount, within rounding —
 * the case that needs no second row, because nothing is left for the
 * original account to keep.
 */
export function isFullSplit(transferAmount: number, amount: number): boolean {
  return transferAmount - amount <= EPSILON;
}

/**
 * What stays with the original account after amount moves elsewhere, rounded
 * to the satang so a split never leaves a fraction the bank never sent.
 */
export function remainingAfterSplit(transferAmount: number, amount: number): number {
  return Math.round((transferAmount - amount) * 100) / 100;
}

export interface SplitFamilyRow {
  fingerprint: string;
  amount: number;
  manualMemberNumber: boolean;
}

// Pieces cut from a row are named after it: "<parent>::split:…" for a share
// given to another member, "<parent>::aside:…" for a part filed as something
// else (lib/transferSetAside.ts). A piece can be split again, so the direct
// parent is up to the last marker.
const PIECE_MARKERS = ["::split:", "::aside:"];

export function parentOfPiece(fingerprint: string): string | null {
  const at = Math.max(...PIECE_MARKERS.map((m) => fingerprint.lastIndexOf(m)));
  return at === -1 ? null : fingerprint.slice(0, at);
}

// The amount the bank reported for a line uploaded from a statement file,
// read back out of its fingerprint (account|payer account|amount|day|
// balance|occurrence — lib/statementReconcile.ts). Null for rows that were
// never a file line (daily-page stand-ins, cash).
export function bankAmountOf(fingerprint: string): number | null {
  if (fingerprint.startsWith("line:")) return null;
  const parts = fingerprint.split("|");
  if (parts.length !== 6 || !/^\d+\.\d{2}$/.test(parts[2])) return null;
  return Number(parts[2]);
}

/**
 * Rows holding more than their share of the bank line now that pieces have
 * been cut from them, with the amount each should hold. The row and every
 * piece taken from it (and from those pieces) add up to the line the bank
 * reported; a re-upload made before split rows were protected wrote the row
 * back at the whole line while its pieces stayed, counting them twice. 13857:
 * ฿5,600 with ฿3,000 given to 9904, the ฿5,600 back.
 *
 * Measured against the bank's own amount where the fingerprint carries it.
 * Otherwise a row with pieces that was never marked manualMemberNumber (which
 * taking a piece always does now) is taken to hold the whole line. A row
 * whose pieces leave nothing for it is left for a person: the pieces are then
 * what is in doubt.
 */
export function overstatedParents(rows: SplitFamilyRow[]): { fingerprint: string; amount: number }[] {
  const pieces = rows.filter((r) => parentOfPiece(r.fingerprint) !== null);
  const out: { fingerprint: string; amount: number }[] = [];
  for (const r of rows) {
    if (parentOfPiece(r.fingerprint) !== null) continue;
    const taken = pieces.filter((p) => p.fingerprint.startsWith(`${r.fingerprint}::`));
    if (taken.length === 0) continue;
    const takenSum = taken.reduce((sum, p) => sum + p.amount, 0);
    const bank = bankAmountOf(r.fingerprint);
    const whole = bank ?? (r.manualMemberNumber ? null : r.amount);
    if (whole === null) continue;
    const amount = remainingAfterSplit(whole, takenSum);
    if (amount > EPSILON && r.amount - amount > EPSILON) out.push({ fingerprint: r.fingerprint, amount });
  }
  return out;
}
