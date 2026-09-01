// Staff identify a round of รายการหัก by the MMYY code they already use for
// the folder on disk (e.g. "0969" = กันยายน 2569), where YY is the last two
// digits of the Buddhist-era year. Keeping that as the canonical id means a
// round on screen matches a folder on their machine with no translation, but
// the code alone is unreadable in a list, so a round also carries a Thai
// label — derived from the code here rather than typed, so the two can never
// disagree.

const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

// Buddhist-era years in this data are 25xx, so "69" means 2569. Two digits
// can't distinguish 2569 from 2669, but the cooperative's folders have used
// this convention for years and a century rollover is not a case worth
// carrying complexity for.
const BE_CENTURY = 2500;

export type DeductionPeriod = { month: number; year: number };

// Returns null for anything that isn't a real MMYY code, including month 00
// and 13+ — the caller turns that into the error message.
export function parseDeductionPeriod(period: string): DeductionPeriod | null {
  if (!/^\d{4}$/.test(period)) return null;
  const month = Number(period.slice(0, 2));
  const year = BE_CENTURY + Number(period.slice(2));
  if (month < 1 || month > 12) return null;
  return { month, year };
}

// "0969" → "กันยายน 2569". Empty string when the code is invalid, so a caller
// that skipped validation degrades to no label rather than a wrong one.
export function describeDeductionPeriod(period: string): string {
  const parsed = parseDeductionPeriod(period);
  if (!parsed) return "";
  return `${THAI_MONTHS[parsed.month - 1]} ${parsed.year}`;
}
