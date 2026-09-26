import { coveredByRealTransfer } from "./roundReach";

// A bank line staff put on a member from the เงินเข้าประจำวัน page before
// the round had that statement (a "line:" row — see the record route and
// line-to-round) is a stand-in for the round's own row. When the statement is
// uploaded into the round afterwards, the same money arrives a second time
// under the bank's own fingerprint, and the member was counted twice: 29746,
// ฿6,000 on 26 ก.ย. shown once as "🔀 ย้ายมาให้คนนี้" and once from the file,
// ชำระเกิน by exactly that ฿6,000.
//
// This pairs each stand-in with the uploaded row it duplicates — same paying
// account, amount and day, the rule the bridge itself checks before it
// writes — so one of the two can go (see lib/bridgeDedupeStore.ts for which).

export interface BridgeRow {
  fingerprint: string;
  accountNumber: string;
  amount: number;
  transferredAt: Date | null;
  memberNumber: string | null;
}

export interface UploadedRow extends BridgeRow {
  manualMemberNumber: boolean;
}

// The bridge rows worth pairing: placed from a daily line, one line to one
// member. A share of a unit's line divided among members ("line:<fp>#…")
// is not a stand-in for any single uploaded row.
export const isStandIn = (fingerprint: string) =>
  fingerprint.startsWith("line:") && !fingerprint.includes("#");

export function pairStandIns<B extends BridgeRow, U extends UploadedRow>(
  bridges: B[],
  uploaded: U[]
): { bridge: B; real: U }[] {
  const taken = new Set<string>();
  const pairs: { bridge: B; real: U }[] = [];
  for (const bridge of bridges) {
    if (!isStandIn(bridge.fingerprint) || !bridge.transferredAt || !bridge.accountNumber) continue;
    const covering = uploaded.filter(
      (u) =>
        !taken.has(u.fingerprint) &&
        !u.fingerprint.startsWith("line:") &&
        coveredByRealTransfer([u], bridge.accountNumber, bridge.amount, bridge.transferredAt as Date)
    );
    // Two identical payments on one day are two rows; the one already
    // counted for the same member is the likelier twin.
    const real = covering.find((u) => u.memberNumber === bridge.memberNumber) ?? covering[0];
    if (!real) continue;
    taken.add(real.fingerprint);
    pairs.push({ bridge, real });
  }
  return pairs;
}
