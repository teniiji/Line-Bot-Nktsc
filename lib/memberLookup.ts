import { namesLikelyMatch } from "./nameMatch";

export interface RosterIdentity {
  memberName: string;
  nationalId: string | null;
  phone: string | null;
}

export interface ClaimedIdentity {
  fullName: string;
  nationalId: string;
  phone: string;
}

const digitsOnly = (value: string): string => value.replace(/\D/g, "");

// Whether a member correctly proved they own this roster record before
// the bot reveals their เลขสมาชิก. Deliberately strict, unlike
// namesLikelyMatch's own lenient empty-string handling (built for a
// different, lower-stakes purpose: not blocking a slip over a missing
// name) — here an empty claim or an incomplete roster record must never
// count as a match, since that's exactly the security check this exists
// for. nationalId/phone compare digits-only so dashes/spaces in either
// don't cause a false mismatch; memberName uses the same lenient
// comparison as slip verification (honorifics/whitespace-insensitive)
// since it's a secondary check behind the two exact-match fields.
export function matchesIdentity(
  roster: RosterIdentity,
  claimed: ClaimedIdentity
): boolean {
  if (!roster.nationalId || !roster.phone) return false;
  if (!claimed.fullName.trim() || !claimed.nationalId.trim() || !claimed.phone.trim()) {
    return false;
  }

  const nationalIdMatches = digitsOnly(roster.nationalId) === digitsOnly(claimed.nationalId);
  const phoneMatches = digitsOnly(roster.phone) === digitsOnly(claimed.phone);
  if (!nationalIdMatches || !phoneMatches) return false;

  return namesLikelyMatch(roster.memberName, claimed.fullName);
}
