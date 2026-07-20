// Deliberately lenient: the goal is to catch a slip that's clearly someone
// else's (a different person entirely), not to flag every minor OCR typo,
// missing honorific, or nickname-vs-legal-name difference as a mismatch —
// system prompt elsewhere already notes the model "has no way to know for
// certain" which name on a slip is the account holder, so false positives
// here just create needless friction for members. Prefer a false "match"
// over a false "mismatch".
const HONORIFIC_PREFIXES = [
  "นางสาว",
  "นาง",
  "นาย",
  "น.ส.",
  "ด.ช.",
  "ด.ญ.",
  "mr.",
  "mrs.",
  "ms.",
  "mr",
  "mrs",
  "ms",
];

function normalizeName(name: string): string {
  let normalized = name.trim().toLowerCase();
  for (const prefix of HONORIFIC_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length);
      break;
    }
  }
  return normalized.replace(/\s+/g, "");
}

// Returns true when there's no clear evidence the names refer to different
// people. Either empty string (nothing to compare) also counts as a match.
export function namesLikelyMatch(claimedName: string, slipName: string): boolean {
  const a = normalizeName(claimedName);
  const b = normalizeName(slipName);
  if (!a || !b) return true;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}
