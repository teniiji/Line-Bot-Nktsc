// Shared validators for MemberRoster's identity-verification fields
// (nationalId, phone) — used by both the one-off import script
// (scripts/import-national-id-phone.ts) and the dashboard's member
// contact editor (app/api/member-roster), so the two never drift apart
// on what counts as a valid value.

export function parseNationalId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length === 13 ? digits : null;
}

// Excel/pandas round-tripping sometimes drops a phone number's leading
// zero (stored as a plain number at some point) — a 9-digit result missing
// only that leading zero is common enough to fix rather than reject.
export function parsePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 9) return `0${digits}`;
  return null;
}
