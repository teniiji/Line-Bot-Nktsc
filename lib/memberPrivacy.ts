// เลขประจำตัวประชาชน is the most sensitive column in the database, and the
// roster panel used to require a search term for exactly that reason: with no
// way to browse, nobody could pull the whole cooperative's IDs onto a screen.
//
// Being unable to browse is a real cost, though — staff cannot see how many
// members are on file, or page through a unit — so browsing is allowed and the
// protection moves to the value instead. A search names the member you are
// verifying and returns their ID in full, which is the job the field exists
// for. Browsing everybody returns it masked: enough to see that a member has
// one on file, and to check the last digits against a document in hand,
// without the list itself being a copy of every ID in the cooperative.
//
// Masked in the API rather than in the component, because a value the browser
// never receives cannot be read out of the network tab.

// Keeps the last four digits, which is what a person checks against a card or
// a form. Anything shorter than that is already too short to be a real
// national ID, so it is masked completely rather than half-revealed.
const VISIBLE_DIGITS = 4;

export function maskNationalId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= VISIBLE_DIGITS) return "x".repeat(trimmed.length);
  const shown = trimmed.slice(-VISIBLE_DIGITS);
  return `${"x".repeat(trimmed.length - VISIBLE_DIGITS)}${shown}`;
}
