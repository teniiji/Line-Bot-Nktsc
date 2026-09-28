// Where a transfer staff placed by hand came from, said on the row itself.
//
// "🔀 ย้ายมาให้คนนี้" told staff a transfer had been moved, not from whom —
// 26418 showed ฿4,000 from account 4130013068, not their own, and nothing on
// screen said whose it was. The round already knows: a split share is named
// after the row it was cut from ("<parent>::split:…"), and a whole transfer
// moved outright still carries the paying account, whose owner the round's
// list or the account directory can name. The row the share came off says so
// too ("แบ่งให้ …"), so the two ends can be matched either way.

const SPLIT_MARKER = "::split:";
const LINE_PREFIX = "line:";

export interface OriginRow {
  id: string;
  fingerprint: string;
  memberNumber: string | null;
  accountNumber: string;
  amount: number;
  manualMemberNumber: boolean;
}

export interface Person {
  memberNumber: string;
  name: string | null;
}

export type TransferOrigin =
  // A share cut from another member's transfer.
  | { kind: "splitFrom"; from: Person | null; total: number }
  // A whole transfer moved here from the account holder.
  | { kind: "movedFrom"; from: Person }
  // Recorded on the เงินเข้าประจำวัน page; owner set when the account is
  // somebody else's.
  | { kind: "recorded"; accountOwner: Person | null };

export interface TransferOriginInfo {
  origin: TransferOrigin | null;
  // Shares this row gave to others ("แบ่งให้ …").
  gaveTo: (Person & { amount: number })[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function transferOrigins(
  rows: OriginRow[],
  accountOwner: (accountNumber: string) => Person | null,
  person: (memberNumber: string) => Person
): Map<string, TransferOriginInfo> {
  const byFingerprint = new Map(rows.map((r) => [r.fingerprint, r]));
  const childrenOf = new Map<string, OriginRow[]>();
  for (const r of rows) {
    const at = r.fingerprint.indexOf(SPLIT_MARKER);
    if (at === -1) continue;
    const parent = r.fingerprint.slice(0, at);
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), r]);
  }

  const result = new Map<string, TransferOriginInfo>();
  for (const r of rows) {
    const gaveTo = (childrenOf.get(r.fingerprint) ?? [])
      .filter((c) => c.memberNumber)
      .map((c) => ({ ...person(c.memberNumber as string), amount: round2(c.amount) }));

    let origin: TransferOrigin | null = null;
    const at = r.fingerprint.indexOf(SPLIT_MARKER);
    if (at !== -1) {
      const parentFp = r.fingerprint.slice(0, at);
      const parent = byFingerprint.get(parentFp);
      const siblings = childrenOf.get(parentFp) ?? [];
      origin = {
        kind: "splitFrom",
        from: parent?.memberNumber ? person(parent.memberNumber) : null,
        total: round2((parent?.amount ?? 0) + siblings.reduce((s, c) => s + c.amount, 0)),
      };
    } else if (r.fingerprint.startsWith(LINE_PREFIX)) {
      const owner = r.accountNumber ? accountOwner(r.accountNumber) : null;
      origin = {
        kind: "recorded",
        accountOwner: owner && owner.memberNumber !== r.memberNumber ? owner : null,
      };
    } else if (r.manualMemberNumber && r.memberNumber && gaveTo.length === 0) {
      const owner = accountOwner(r.accountNumber);
      if (owner && owner.memberNumber !== r.memberNumber) origin = { kind: "movedFrom", from: owner };
    }
    if (origin || gaveTo.length > 0) result.set(r.id, { origin, gaveTo });
  }
  return result;
}
