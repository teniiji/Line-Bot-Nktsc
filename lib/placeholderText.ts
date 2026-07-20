// Catches the model inventing a filler value (e.g. "<UNKNOWN>") for a
// required free-text field instead of asking the user again — a real
// production incident: a member gave their name but not a member number,
// and the model called submit_member_info with memberNumber: "<UNKNOWN>"
// rather than leaving the field unfilled (the tool schema requires it),
// which then got saved as if it were a real member number and even
// resolved as "verified" once staff clicked confirm without noticing.
const PLACEHOLDER_VALUES = new Set([
  "unknown",
  "unk",
  "n/a",
  "na",
  "none",
  "null",
  "nil",
  "-",
  "--",
  ".",
  "?",
  "??",
  "ไม่ทราบ",
  "ไม่มี",
  "ไม่ระบุ",
  "ไม่รู้",
  "ไม่แน่ใจ",
]);

export function isPlaceholderText(value: string): boolean {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^[<*"'(]+|[>*"')]+$/g, "")
    .trim();
  return normalized.length === 0 || PLACEHOLDER_VALUES.has(normalized);
}
