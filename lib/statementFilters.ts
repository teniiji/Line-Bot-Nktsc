import { StatementMemberRow } from "./types";

// Filtering/sorting for the เทียบ Statement table. Kept out of the component
// because these are the rules staff actually reason about ("who in this unit
// still owes", "who has no account number to match at all") and they are
// worth testing directly.

export interface StatementFilter {
  search: string;
  unitName: string; // "" = ทุกสังกัด
  // รหัสหน่วยคุม — the H-code from column J of the หักไม่ได้ sheet. "" = ทุกหน่วยคุม.
  // A coarser grouping than สังกัด, and the one the cooperative's own summaries
  // ("สรุปหน่วยคุม") are organised by, so it is how staff divide the chasing up.
  hCode: string;
  status: string; // "all" | "paid" | "overpaid" | "unpaid" | "no_account"
}

export type StatementSort =
  | "default"
  | "outstanding"
  | "name"
  | "memberNumber"
  | "hCode"
  | "unitName"
  | "paidAt";

const digitsOnly = (value: string) => value.replace(/\D/g, "");

// H-codes are 1-2 digit numbers, so they compare as numbers — as text,
// หน่วยคุม 10 would sort between 1 and 2. Members carrying no code at all sort
// last: they are a gap in the sheet, not หน่วยคุม zero.
function compareHCode(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, "th");
}

// Blank สังกัด sorts last for the same reason as a blank หน่วยคุม.
function compareUnitName(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, "th");
}

// Latest transfer first. Someone who never paid has no date, and belongs at
// the end rather than at the top where an epoch-zero fallback would put them.
function comparePaidAt(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  if (Number.isNaN(ta)) return 1;
  if (Number.isNaN(tb)) return -1;
  return tb - ta;
}

const byMemberNumber = (a: StatementMemberRow, b: StatementMemberRow) =>
  a.memberNumber.localeCompare(b.memberNumber, "th", { numeric: true });

// A member's outstanding balance. Negative would mean they overpaid, which is
// not "owing", so anything at or below zero is zero for ranking purposes.
export function outstandingOf(m: StatementMemberRow): number {
  return Math.max(0, Math.round((m.amountDue - m.amountPaid) * 100) / 100);
}

function matchesSearch(m: StatementMemberRow, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;

  const haystack = [m.name, m.memberNumber, m.accountNumber ?? "", m.unitName ?? ""]
    .join(" ")
    .toLowerCase();
  if (haystack.includes(needle)) return true;

  // Account numbers get written with dashes ("413-1-23456-7") as often as
  // without, and the sheet stores only one of the two forms — compare the
  // digits alone so either way of typing it finds the same person.
  const needleDigits = digitsOnly(needle);
  if (!needleDigits) return false;
  return [m.accountNumber ?? "", m.memberNumber].some((field) =>
    digitsOnly(field).includes(needleDigits)
  );
}

function matchesStatus(m: StatementMemberRow, status: string): boolean {
  if (status === "all") return true;
  // Not a status the reconciliation produces, but the bucket staff most need
  // to act on: without an account number the transfer can never match, so
  // these would otherwise sit in "ยังค้าง" looking like people who did not pay.
  // Asked of the people this round is chasing, since a member whose unit has
  // not reported is not somebody with a missing account — they are somebody
  // who may turn out to owe nothing at all.
  // Genuinely nobody's: a member the directory holds accounts for is not
  // unmatchable, they are ambiguous — their money still finds them through
  // the directory, and putting them in this bucket sends staff hunting for
  // an account number the cooperative already has.
  if (status === "no_account") {
    return (
      !m.accountNumber &&
      (m.knownAccounts?.length ?? 0) === 0 &&
      m.deductionResult === "uncollected"
    );
  }
  if (status === "many_accounts") return !m.accountNumber && (m.knownAccounts?.length ?? 0) > 1;
  // The round's chase population as one bucket: everyone payroll could not
  // deduct from, whether or not they have since transferred the money.
  if (status === "uncollected") return m.deductionResult === "uncollected";
  return m.status === status;
}

export function filterStatementMembers(
  rows: StatementMemberRow[],
  filter: StatementFilter
): StatementMemberRow[] {
  return rows.filter(
    (m) =>
      matchesStatus(m, filter.status) &&
      (!filter.hCode || m.hCode === filter.hCode) &&
      (!filter.unitName || m.unitName === filter.unitName) &&
      matchesSearch(m, filter.search)
  );
}

export function sortStatementMembers(
  rows: StatementMemberRow[],
  sort: StatementSort
): StatementMemberRow[] {
  // "default" is the order the API already returned (still-owing first, then
  // by สังกัด/เลขสมาชิก) — re-sorting it here would only undo that.
  if (sort === "default") return rows;

  const copy = [...rows];
  if (sort === "outstanding") {
    copy.sort((a, b) => outstandingOf(b) - outstandingOf(a));
  } else if (sort === "name") {
    copy.sort((a, b) => a.name.localeCompare(b.name, "th"));
  } else if (sort === "memberNumber") {
    copy.sort(byMemberNumber);
  } else if (sort === "hCode") {
    // Grouping sorts get a second and third key so the rows inside a group
    // are in a readable order rather than whatever order they arrived in.
    copy.sort(
      (a, b) =>
        compareHCode(a.hCode, b.hCode) ||
        compareUnitName(a.unitName, b.unitName) ||
        byMemberNumber(a, b)
    );
  } else if (sort === "unitName") {
    copy.sort((a, b) => compareUnitName(a.unitName, b.unitName) || byMemberNumber(a, b));
  } else if (sort === "paidAt") {
    copy.sort((a, b) => comparePaidAt(a.paidAt, b.paidAt) || byMemberNumber(a, b));
  }
  return copy;
}

// Totals for whatever subset is on screen. The round-wide totals stay useful,
// but next to a filtered table they answer the wrong question — "ยอดค้างของ
// สังกัดนี้" is the number staff are about to act on.
export function summarizeStatementMembers(rows: StatementMemberRow[]) {
  const due = rows.reduce((sum, m) => sum + m.amountDue, 0);
  const paid = rows.reduce((sum, m) => sum + m.amountPaid, 0);
  return {
    count: rows.length,
    due: Math.round(due * 100) / 100,
    paid: Math.round(paid * 100) / 100,
    outstanding: Math.round((due - paid) * 100) / 100,
  };
}

// หน่วยคุม and สังกัด are one thing written at two grains, not two things:
// the H-code is what the cooperative's own สรุปหน่วยคุม counts by (75), and
// the name is the line the file writes under it ("ตจว.1 หักผ่านธนาคารกรุงไทย",
// column G of the ไฟล์รวม). Offered as two dropdowns they read as a
// hierarchy to navigate, and a code and a name that belong to different
// members could be chosen together and match nobody.
//
// So they are offered as one list: each หน่วยคุม, then the สังกัด lines
// inside it. Picking is one act, and every choice on it has rows behind it.
export interface UnitChoice {
  hCode: string | null;
  units: string[];
}

export function unitChoicesOf(rows: StatementMemberRow[]): UnitChoice[] {
  const groups = new Map<string | null, Set<string>>();
  for (const m of rows) {
    const key = m.hCode || null;
    if (!groups.has(key)) groups.set(key, new Set());
    if (m.unitName) groups.get(key)!.add(m.unitName);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => compareHCode(a, b))
    .map(([hCode, units]) => ({
      hCode,
      units: [...units].sort((a, b) => a.localeCompare(b, "th")),
    }));
}

// The one dropdown's value. A member with no หน่วยคุม still has a สังกัด to
// be picked by, so a name is selectable on its own rather than only beneath
// a code.
export function encodeUnitChoice(filter: { hCode: string; unitName: string }): string {
  if (filter.unitName) return `u:${filter.unitName}`;
  if (filter.hCode) return `h:${filter.hCode}`;
  return "";
}

export function parseUnitChoice(value: string): { hCode: string; unitName: string } {
  if (value.startsWith("h:")) return { hCode: value.slice(2), unitName: "" };
  if (value.startsWith("u:")) return { hCode: "", unitName: value.slice(2) };
  return { hCode: "", unitName: "" };
}

