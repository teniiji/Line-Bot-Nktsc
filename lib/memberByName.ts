import { nameKey } from "./senderName";

// The member number of a member who gave their name but not their number —
// "จำไม่ได้ค่ะ ปกติแจ้งแต่เลขบัญชี". The register already knows it; asking
// again only lengthens the chat. Taken only when it is unambiguous:
//   1. an earlier deposit to the same account was recorded under a member
//      whose registered name is this name;
//   2. otherwise, exactly one register row has this name.
// The register row must not belong to another LINE account.

export interface RosterName {
  memberNumber: string;
  memberName: string;
  lineUserId: string | null;
}

export function memberNumberByName(input: {
  fullName: string;
  lineUserId: string;
  // Register rows whose name may be this one (narrowed by the caller).
  roster: RosterName[];
  // Member numbers earlier deposits to the same account were recorded under.
  depositMembers: string[];
}): string | null {
  const key = nameKey(input.fullName);
  if (key.length < 4) return null;
  const mine = input.roster.filter(
    (r) => nameKey(r.memberName) === key && (!r.lineUserId || r.lineUserId === input.lineUserId)
  );
  const byDeposit = Array.from(new Set(input.depositMembers)).filter((n) => mine.some((r) => r.memberNumber === n));
  if (byDeposit.length === 1) return byDeposit[0];
  const numbers = Array.from(new Set(mine.map((r) => r.memberNumber)));
  return numbers.length === 1 ? numbers[0] : null;
}

export const digitsOnly = (value: string | null | undefined) => String(value ?? "").replace(/\D/g, "");
