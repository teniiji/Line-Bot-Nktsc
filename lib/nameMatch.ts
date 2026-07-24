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

function stripHonorific(name: string): string {
  const lower = name.trim().toLowerCase();
  for (const prefix of HONORIFIC_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return name.trim().slice(prefix.length).trim();
    }
  }
  return name.trim();
}

function normalizeName(name: string): string {
  return stripHonorific(name).toLowerCase().replace(/\s+/g, "");
}

// A bank's own transfer slip commonly masks or truncates part of the
// sender's surname for privacy (e.g. "นายศักดิ์สิทธิ์ ค***", "สมชาย ใ.."),
// which breaks the plain substring check below even though it's genuinely
// the same person. A literal asterisk/bullet/period is unambiguous — real
// Thai surnames don't contain one — so a single occurrence is enough;
// "x"/"X" only counts doubled, since a lone "x" is a legitimate letter in
// some real names.
function looksMasked(part: string): boolean {
  if (!part) return false;
  return /[*•●○×.]/.test(part) || /x{2,}/i.test(part);
}

// Splits into (ชื่อจริง, นามสกุล) — null if there's no second word to treat
// as a surname (single-word names, e.g. a nickname-only claim).
function splitGivenAndSurname(name: string): { given: string; surname: string } | null {
  const parts = stripHonorific(name).split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { given: parts[0], surname: parts.slice(1).join(" ") };
}

// Returns true when there's no clear evidence the names refer to different
// people. Either empty string (nothing to compare) also counts as a match.
export function namesLikelyMatch(claimedName: string, slipName: string): boolean {
  const a = normalizeName(claimedName);
  const b = normalizeName(slipName);
  if (!a || !b) return true;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  // Fall back to comparing given names alone when the other side's surname
  // looks masked/truncated rather than showing a genuinely different one —
  // a masked surname is not evidence of a different person.
  const claimedParts = splitGivenAndSurname(claimedName);
  const slipParts = splitGivenAndSurname(slipName);
  if (claimedParts && slipParts) {
    const givenNamesMatch =
      normalizeName(claimedParts.given) === normalizeName(slipParts.given);
    if (
      givenNamesMatch &&
      (looksMasked(slipParts.surname) || looksMasked(claimedParts.surname))
    ) {
      return true;
    }
  }

  return false;
}
