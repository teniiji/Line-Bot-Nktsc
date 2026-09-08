// Deciding whether two member numbers name the same member.
//
// The reconciliation compares numbers that reached the system by different
// routes and are written differently along the way. A real case, 8 Sep 2026:
//
//   the หักไม่ได้ sheet says account 9825072199 belongs to  "29262"
//   the slip นางสาวภรณ์ทิพย์ sent through the bot says      "029262"
//
// Same member. Not the same string. reconcileDay read that as two different
// people and refused the pairing outright — which is the right instinct
// applied to a difference that is not one, so her ฿4,200 sat in
// "มีสลิปแต่ไม่เจอเงินเข้า" while the money was in the statement all along.
//
// The refusal itself is worth keeping: a deposit whose account is known to
// belong to somebody else really is not this member's payment, whatever the
// amount says. It just has to be asked about the member, not about the
// spelling.
//
// Only leading zeros are normalised, and deliberately nothing else. Every
// further step — dropping spaces, hyphens, case — is another way two genuinely
// different members could be merged into one, and merging two members means
// filing one person's money under another's. Leading zeros are the one
// difference there is evidence for, and "029262" and "29262" cannot be two
// different members of the same cooperative.

// The comparable form of a member number: trimmed, with leading zeros
// removed. Never reduced to nothing — a number of all zeros keeps one digit,
// so it stays a value that can be compared rather than becoming "missing".
//
// Returns null when there is no number at all, which is not the same as two
// numbers that fail to match: a slip with no member number cannot contradict
// anything, and sameMember below says so.
export function memberNumberKey(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^0+(?=.)/, "");
}

// Whether two member numbers name the same member. False when either is
// missing: "nothing is known" must never read as agreement, because the
// reconciliation uses this to decide that a payment IS a member's.
export function sameMember(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = memberNumberKey(a);
  const right = memberNumberKey(b);
  return left !== null && right !== null && left === right;
}

// Whether two member numbers are known to name different members. Kept apart
// from !sameMember on purpose: the reconciliation refuses a pairing on this,
// and a missing number is not grounds to refuse anything.
export function differentMembers(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const left = memberNumberKey(a);
  const right = memberNumberKey(b);
  return left !== null && right !== null && left !== right;
}
