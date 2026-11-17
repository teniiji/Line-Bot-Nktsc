import type { LineUserInfo } from "./agent/types";

// Who a LINE account is, from what the system already holds — so a member
// the cooperative already knows is never asked for their name and number
// again. A member sent a payslip and said กู้สามัญ, and was asked for ชื่อ-
// นามสกุล, เลขสมาชิก and a phone number, all three already on record: staff
// had set the member number on สมาชิก LINE (which shows the register's name
// beside it), and the register holds the phone.
//
// In order of strength:
//   1. a register row bound to this LINE account — verified;
//   2. the member number on the LINE account, with the name taken from the
//      register row for that number when the account has none of its own —
//      not verified, so a forwarded request still says to check;
//   3. whatever the member typed.
// The phone falls back to the register's when the member has not given one.

export interface RosterRow {
  memberNumber: string;
  memberName: string;
  phone: string | null;
  lineUserId: string | null;
}

export interface LineUserRow {
  id: string;
  fullName: string | null;
  memberNumber: string | null;
  phone: string | null;
}

export function resolveLineUserIdentity(input: {
  bound: RosterRow | null;
  user: LineUserRow | null;
  // The register row for user.memberNumber, if any.
  byNumber: RosterRow | null;
}): LineUserInfo | null {
  const { bound, user, byNumber } = input;
  if (bound) {
    return {
      fullName: bound.memberName,
      memberNumber: bound.memberNumber,
      verified: true,
      phone: user?.phone || bound.phone || null,
    };
  }
  if (!user) return null;
  // A register row bound to some other LINE account belongs to that member.
  const row =
    byNumber && byNumber.memberNumber === user.memberNumber && (!byNumber.lineUserId || byNumber.lineUserId === user.id)
      ? byNumber
      : null;
  return {
    fullName: user.fullName || row?.memberName || null,
    memberNumber: user.memberNumber,
    verified: false,
    phone: user.phone || row?.phone || null,
  };
}
