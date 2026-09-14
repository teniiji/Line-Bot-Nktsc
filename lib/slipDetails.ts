// The two things on a transfer slip that were being thrown away.
//
// Until now a slip contributed an amount, a date and the sender's *name* to
// the daily reconciliation. That leaves almost every pairing resting on the
// amount alone, and on a day when eleven people each send ฿5,000 the amount
// says nothing. Two more things are printed on nearly every Thai slip and
// were simply not read:
//
//   * the time of the transfer — which turns "one of eleven ฿5,000 payments"
//     into "the one posted three minutes later"
//   * the paying account — masked, but the visible digits are the bank's own
//     statement of who paid, and they need no directory to be useful
//
// Both are best-effort: a slip may show neither, and what is read comes from
// a vision model, so everything here is written to fail closed. A time that
// does not parse is null, not a guess; an account whose visible digits are
// too few to tell payers apart is "unknown", not a match.

// The characters Thai banking apps use to hide the digits of an account. The
// slip's own separators (hyphen, space) are dropped instead — they carry no
// information and differ between apps.
const MASK_CHARS = "xX*•·●○◦∙⋅?#";
const SEPARATORS = /[\s\-–—_.()]/g;

// Below this many visible digits an account pattern cannot tell one member
// from another: three digits is one payer in a thousand, which on a busy day
// is not a match, it is a coincidence waiting to be filed as fact.
const MIN_VISIBLE_DIGITS = 4;

// Shortest thing that could be an account at all. Under this the pattern is
// some fragment the model happened to catch — a receipt number, a branch
// code — and comparing it would invent agreement.
const MIN_PATTERN_LENGTH = 6;

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

const toArabicDigits = (text: string): string =>
  text.replace(/[๐-๙]/g, (digit) => String(THAI_DIGITS.indexOf(digit)));

// The time printed on the slip, as "HH:MM" on a 24-hour clock, or null.
//
// Thai apps print this a dozen ways — "09:07", "9:07 น.", "09:07:46",
// "๐๙:๐๗" — and the model relays whatever it saw. Seconds are dropped: no
// two records of the same payment agree to the second, and the reconciliation
// only ever asks which minute is closest.
export function parseSlipTime(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = toArabicDigits(raw).trim();
  if (!text) return null;

  const match = text.match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  // A slip cannot be timed at 25:70. Something that parses to an impossible
  // clock is a misread, and a misread time is worse than no time — it would
  // rank a pairing confidently in the wrong direction.
  if (hour > 23 || minute > 59) return null;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// Minutes since midnight, for comparing a slip's clock against the bank's.
export function slipTimeMinutes(time: string | null): number | null {
  if (!time) return null;
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

// The paying account as printed, reduced to digits and wildcards: separators
// dropped, every masking character collapsed to a single "x". Returns null
// when what was read cannot be an account, or shows too little of one to
// distinguish payers.
export function normalizeAccountPattern(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const stripped = toArabicDigits(raw).replace(SEPARATORS, "");
  if (!stripped) return null;

  let pattern = "";
  let visible = 0;
  for (const char of stripped) {
    if (char >= "0" && char <= "9") {
      pattern += char;
      visible++;
    } else if (MASK_CHARS.includes(char)) {
      pattern += "x";
    } else {
      // A letter or a word means this is not an account number — a bank name,
      // "ไม่ระบุ", the account holder's name. Refused outright rather than
      // salvaged, because a salvaged fragment is exactly what produces a
      // confident wrong pairing.
      return null;
    }
  }

  if (pattern.length < MIN_PATTERN_LENGTH) return null;
  if (visible < MIN_VISIBLE_DIGITS) return null;
  return pattern;
}

// What the slip's account says about a statement line's paying account.
//
//   match    — every digit the slip shows agrees, and it shows enough of them
//   conflict — the slip shows a digit the statement contradicts, at the same
//              length, so these are two different accounts
//   unknown  — nothing can be said: no pattern, no account on the statement,
//              or too little overlap to be worth anything
export type AccountVerdict = "match" | "conflict" | "unknown";

export function compareSlipAccount(
  slipAccount: string | null,
  statementAccount: string | null
): AccountVerdict {
  const pattern = slipAccount ? normalizeAccountPattern(slipAccount) : null;
  if (!pattern || !statementAccount) return "unknown";

  const account = toArabicDigits(statementAccount).replace(/\D/g, "");
  if (!account) return "unknown";

  // Banks mask from the left, so the digits that survive are the last ones —
  // the two are compared right-aligned, over as much as they share.
  const overlap = Math.min(pattern.length, account.length);
  if (overlap < MIN_VISIBLE_DIGITS) return "unknown";

  let agreed = 0;
  let disagreed = false;
  for (let offset = 1; offset <= overlap; offset++) {
    const patternChar = pattern[pattern.length - offset];
    if (patternChar === "x") continue;
    if (patternChar === account[account.length - offset]) agreed++;
    else disagreed = true;
  }

  if (disagreed) {
    // Only call it a conflict when the two are the same length. Different
    // lengths mean the right-alignment itself is an assumption — one of them
    // may carry a branch prefix the other doesn't — and a wrong assumption
    // must not be allowed to refuse a real pairing.
    return pattern.length === account.length ? "conflict" : "unknown";
  }

  return agreed >= MIN_VISIBLE_DIGITS ? "match" : "unknown";
}
