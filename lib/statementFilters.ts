import { StatementMemberRow } from "./types";
import { stripHonorific } from "./nameMatch";

// Filtering/sorting for the เทียบ Statement table. Kept out of the component
// because these are the rules staff actually reason about ("who in this unit
// still owes", "who has no account number to match at all") and they are
// worth testing directly.

export interface StatementFilter {
  search: string;
  // The two levels a member sits at, filtered separately because they are
  // separate: หน่วยคุม is what the cooperative's own สรุปหน่วยคุม counts by
  // and how the chasing up is divided (64 of them), and the หน่วยคุมย่อย
  // beneath it is the school or office itself (656).
  //
  // Both take several at once — "these three units are mine this week" is
  // one question, and asked one at a time it takes three passes and three
  // exports, with the totals under the table never adding up to the three
  // of them. An empty list is no filter at all.
  hCodes: string[];
  // Encoded หน่วยคุมย่อย — see encodeSubUnit.
  subUnits: string[];
  status: string; // "all" | "paid" | "overpaid" | "unpaid" | "no_account" | "cash"
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

// Codes compare as numbers — as text, หน่วยคุม 10 would sort between 1 and
// 2, and สังกัด 103003 between 100 and 13003. Members carrying no code at
// all sort last: that is a gap in the sheet, not code zero.
function compareCode(a: string | null, b: string | null): number {
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

// Every distinct account a member is known by — the round's own and the
// directory's — for "มีหลายเลขบัญชี", which counts everyone with more than
// one, whether or not the sheet happened to name one of them.
export function accountsOf(m: Pick<StatementMemberRow, "accountNumber" | "knownAccounts">): string[] {
  return [...new Set([...(m.accountNumber ? [m.accountNumber] : []), ...(m.knownAccounts ?? [])])];
}

// A member's outstanding balance. Negative would mean they overpaid, which is
// not "owing", so anything at or below zero is zero for ranking purposes.
export function outstandingOf(m: StatementMemberRow): number {
  return Math.max(0, Math.round((m.amountDue - m.amountPaid) * 100) / 100);
}

function matchesSearch(m: StatementMemberRow, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;

  const haystack = [
    m.name,
    m.memberNumber,
    m.accountNumber ?? "",
    m.unitName ?? "",
    // The สังกัด's own code, which is how the cooperative's own lists name a
    // school: typed into the search box it should find that school's members.
    m.unitCode ?? "",
  ]
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

// Exported so the chips above the table can be counted by the very rule
// they filter by. Counting one way and filtering another is how a chip comes
// to promise rows that are not there.
export function matchesStatus(m: StatementMemberRow, status: string): boolean {
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
  if (status === "many_accounts") return accountsOf(m).length > 1;
  // At least one payment counted toward this member came in as cash rather
  // than off a bank line — see app/api/statement-rounds/[id]/cash/route.ts.
  // includes() rather than equality: paidBranch reads "เงินสด + หนองคาย" for
  // someone who paid partly by cash and partly by transfer.
  if (status === "cash") return m.paidBranch?.includes("เงินสด") ?? false;
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
      (filter.hCodes.length === 0 || (m.hCode !== null && filter.hCodes.includes(m.hCode))) &&
      (filter.subUnits.length === 0 || filter.subUnits.includes(encodeSubUnit(m))) &&
      matchesSearch(m, filter.search)
  );
}

type Comparator = (a: StatementMemberRow, b: StatementMemberRow) => number;

const COMPARATORS: Record<Exclude<StatementSort, "default">, Comparator> = {
  outstanding: (a, b) => outstandingOf(b) - outstandingOf(a),
  // Stripped of นาย/นาง/นางสาว first — otherwise the sort groups by honorific
  // before it groups by name, which is not what "ชื่อ ก-ฮ" means to staff.
  name: (a, b) => stripHonorific(a.name).localeCompare(stripHonorific(b.name), "th"),
  memberNumber: byMemberNumber,
  // The หน่วยคุม carries its own second key: inside a unit, the rows belong
  // grouped by the สังกัด they came from rather than interleaved.
  hCode: (a, b) =>
    compareCode(a.hCode, b.hCode) ||
    compareCode(a.unitCode, b.unitCode) ||
    compareUnitName(a.unitName, b.unitName),
  unitName: (a, b) =>
    compareCode(a.unitCode, b.unitCode) || compareUnitName(a.unitName, b.unitName),
  paidAt: (a, b) => comparePaidAt(a.paidAt, b.paidAt),
};

// Several orderings at once, applied in the order they were chosen: หน่วยคุม
// first and ยอดค้างมาก→น้อย after it is "work through the units, biggest
// debt first in each" — one question, which a single ordering could not ask.
export function sortStatementMembers(
  rows: StatementMemberRow[],
  sort: StatementSort | StatementSort[]
): StatementMemberRow[] {
  const keys = (Array.isArray(sort) ? sort : [sort]).filter(
    (key): key is Exclude<StatementSort, "default"> => key !== "default"
  );
  // Nothing chosen leaves the order the API already returned (still-owing
  // first, then by สังกัด/เลขสมาชิก) — re-sorting it here would only undo it.
  if (keys.length === 0) return rows;

  const copy = [...rows];
  copy.sort((a, b) => {
    for (const key of keys) {
      const result = COMPARATORS[key](a, b);
      if (result !== 0) return result;
    }
    // Rows the chosen orderings cannot separate still need a stable place.
    return byMemberNumber(a, b);
  });
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

// The หน่วยคุม on offer, in the numeric order the table sorts by, so the
// dropdown and the sorted table agree on what comes after what.
export function hCodesOf(rows: StatementMemberRow[]): string[] {
  const codes = new Set<string>();
  for (const m of rows) if (m.hCode) codes.add(m.hCode);
  return [...codes].sort(compareCode);
}

// One school or office: the รหัสสังกัด and the name, as they are written
// together on the cooperative's own lists ("13003 ร.ร.อนุบาลอรุณรังษี").
// A round imported before รหัสสังกัด was read has the name alone, which is
// still something to pick by.
export interface SubUnit {
  code: string | null;
  name: string | null;
  label: string;
  value: string;
}

// Narrowed to one หน่วยคุม when one is chosen: 656 สังกัด in a dropdown is
// not a list anybody reads, and a สังกัด from outside the chosen หน่วยคุม
// would only ever produce an empty table.
export function subUnitsOf(rows: StatementMemberRow[], hCodes: string[] = []): SubUnit[] {
  const found = new Map<string, SubUnit>();
  for (const m of rows) {
    if (hCodes.length > 0 && (m.hCode === null || !hCodes.includes(m.hCode))) continue;
    if (!m.unitCode && !m.unitName) continue;
    const value = encodeSubUnit(m);
    if (found.has(value)) continue;
    found.set(value, {
      code: m.unitCode,
      name: m.unitName,
      label: [m.unitCode, m.unitName].filter(Boolean).join(" "),
      value,
    });
  }
  return [...found.values()].sort(
    (a, b) => compareCode(a.code, b.code) || compareUnitName(a.name, b.name)
  );
}

// Keyed on the code where the round has one, because two สังกัด can share a
// name (656 codes against 646 names in the ไฟล์รวม) and picking one of them
// should not quietly bring the other along.
export function encodeSubUnit(unit: { unitCode: string | null; unitName: string | null }): string {
  if (unit.unitCode) return `c:${unit.unitCode}`;
  return unit.unitName ? `u:${unit.unitName}` : "";
}

export function parseSubUnit(value: string): { unitCode: string; unitName: string } {
  if (value.startsWith("c:")) return { unitCode: value.slice(2), unitName: "" };
  if (value.startsWith("u:")) return { unitCode: "", unitName: value.slice(2) };
  return { unitCode: "", unitName: "" };
}

