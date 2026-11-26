// The monthly share-and-debt report (รายงานหุ้นหนี้), and laying it over the
// yearly coverage file.
//
// The yearly file (สมาชิกทำประกันและฌาปนกิจ_ปี.xlsx) carries each member's
// shares and debt as they stood on one date. Debt moves every month — new
// loans, repayments — so the collateral picture drifts from the day the file
// was made. Importing the month's report replaces those three figures (หุ้น,
// หนี้, งวดหุ้น) and leaves everything the file alone knows (the policy, the
// associations, the undeducted items) as it was.
//
// Columns are found by heading, never by position, as for the yearly file.
// The report may give total debt in one column, or one column per kind of
// loan; without a total the loan columns are added up, and the import names
// them so staff can check the right ones were taken.

import { isPlausibleMemberNumber, memberNumberKey } from "./memberNumber";
import type { CoverageInput } from "./coverage";

export class ShareDebtSheetError extends Error {}

export interface ShareDebtEntry {
  memberNumber: string;
  memberName: string | null;
  // Null when the report has no such column: the file's figure stays.
  shares: number | null;
  debt: number | null;
  sharePeriods: number | null;
}

export interface ShareDebtSheet {
  entries: ShareDebtEntry[];
  // The headings the debt was read from — one total, or the loans added up.
  debtColumns: string[];
  sharesColumn: string | null;
  periodsColumn: string | null;
  duplicates: number;
}

const norm = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");

const MEMBER = ["เลขสมาชิก", "เลขที่สมาชิก", "ทะเบียนสมาชิก", "รหัสสมาชิก", "memberno"];
const NAME = ["ชื่อ-สกุล", "ชื่อ-นามสกุล", "ชื่อสมาชิก", "ชื่อ"];
// งวดหุ้น is checked before หุ้น so "งวดหุ้น" is never taken as the amount.
const PERIODS = ["งวดหุ้น", "อายุสมาชิก(งวด)", "จำนวนงวดหุ้น", "งวดที่ส่งหุ้น"];
// The plain "หุ้น" last, so as a prefix it cannot take "หุ้นรายเดือน" ahead
// of the balance.
const SHARES = ["ทุนเรือนหุ้น", "หุ้นสะสม", "ยอดหุ้น", "ค่าหุ้นสะสม", "หุ้นคงเหลือ", "หุ้น"];
const DEBT_TOTAL = ["หนี้รวม", "รวมหนี้", "ยอดหนี้รวม", "หนี้คงเหลือรวม", "รวมหนี้คงเหลือ", "รวมเงินกู้", "หนี้", "ยอดหนี้"];
// A loan's balance column, when there is no total.
const LOAN = /^(เงินกู้|หนี้|สัญญา|กู้)|คงเหลือ|ฉุกเฉิน|สามัญ|พิเศษ/;
const NOT_LOAN = /หุ้น|ดอกเบี้ย|งวด|ส่ง|ชำระ|เลขที่|วันที่|อายุ|เงินฝาก|ชื่อ|หน่วย|สังกัด/;

function findExact(cells: string[], names: string[], used: Set<number>): number {
  for (const name of names) {
    const i = cells.findIndex((c, idx) => !used.has(idx) && c === norm(name));
    if (i >= 0) return i;
  }
  return -1;
}

function findPrefix(cells: string[], names: string[], used: Set<number>): number {
  for (const name of names) {
    const i = cells.findIndex((c, idx) => !used.has(idx) && c.startsWith(norm(name)));
    if (i >= 0) return i;
  }
  return -1;
}

const find = (cells: string[], names: string[], used: Set<number>) => {
  const i = findExact(cells, names, used);
  return i >= 0 ? i : findPrefix(cells, names, used);
};

interface Columns {
  member: number;
  name: number;
  periods: number;
  shares: number;
  debt: number[];
}

function findColumns(header: unknown[]): Columns | null {
  const cells = header.map(norm);
  const used = new Set<number>();
  const member = find(cells, MEMBER, used);
  if (member < 0) return null;
  used.add(member);
  const periods = find(cells, PERIODS, used);
  if (periods >= 0) used.add(periods);
  const shares = find(cells, SHARES, used);
  if (shares >= 0) used.add(shares);
  const name = find(cells, NAME, used);
  if (name >= 0) used.add(name);

  const total = find(cells, DEBT_TOTAL, used);
  const debt =
    total >= 0
      ? [total]
      : cells.map((c, i) => (!used.has(i) && c && LOAN.test(c) && !NOT_LOAN.test(c) ? i : -1)).filter((i) => i >= 0);

  if (shares < 0 && debt.length === 0) return null;
  return { member, name, periods, shares, debt };
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/,/g, "").trim();
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const text = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

const round2 = (x: number) => Math.round(x * 100) / 100;

export function parseShareDebtSheet(pages: unknown[][][]): ShareDebtSheet {
  for (const rows of pages) {
    for (let h = 0; h < Math.min(rows.length, 10); h++) {
      const cols = findColumns(rows[h] ?? []);
      if (!cols) continue;
      const header = rows[h];
      const entries = new Map<string, ShareDebtEntry>();
      let duplicates = 0;

      for (const row of rows.slice(h + 1)) {
        const raw = text(row?.[cols.member]);
        if (!raw) continue;
        const key = memberNumberKey(raw.replace(/\.0+$/, ""));
        if (!key || !isPlausibleMemberNumber(key)) continue; // a total line
        if (entries.has(key)) {
          duplicates++;
          continue;
        }
        const loans = cols.debt.map((i) => num(row[i]));
        const periods = cols.periods >= 0 ? num(row[cols.periods]) : null;
        entries.set(key, {
          memberNumber: key,
          memberName: cols.name >= 0 ? text(row[cols.name]) : null,
          shares: cols.shares >= 0 ? round2(num(row[cols.shares]) ?? 0) : null,
          // A blank loan cell is no loan of that kind.
          debt: cols.debt.length ? round2(loans.reduce<number>((s, x) => s + (x ?? 0), 0)) : null,
          sharePeriods: periods == null ? null : Math.trunc(periods),
        });
      }

      return {
        entries: [...entries.values()],
        debtColumns: cols.debt.map((i) => String(header[i] ?? "").trim()),
        sharesColumn: cols.shares >= 0 ? String(header[cols.shares] ?? "").trim() : null,
        periodsColumn: cols.periods >= 0 ? String(header[cols.periods] ?? "").trim() : null,
        duplicates,
      };
    }
  }
  throw new ShareDebtSheetError(
    'ไม่พบหัวคอลัมน์ "เลขสมาชิก" พร้อม "หุ้น" หรือ "หนี้" ในไฟล์ — ใช้รายงานหุ้นหนี้ที่มีหัวตาราง'
  );
}

// ---- Laying the report over the coverage rows --------------------------------

export interface ShareReportInfo {
  label: string;
  asOf: string;
}

export type WithShareReport<T> = T & {
  // The file's own figures, kept so the breakdown can say what changed.
  fileShares?: number;
  fileDebt?: number | null;
  // Not in the report: the file's figures stand.
  notInShareReport?: boolean;
};

export const NOT_IN_SHARE_REPORT = "ไม่มีในรายงานหุ้นหนี้";

export function applyShareReport<T extends CoverageInput>(
  members: T[],
  entries: Map<string, Pick<ShareDebtEntry, "shares" | "debt" | "sharePeriods">>
): WithShareReport<T>[] {
  return members.map((m) => {
    const e = entries.get(m.memberNumber);
    if (!e) return { ...m, notInShareReport: true };
    return {
      ...m,
      fileShares: m.shares,
      fileDebt: m.debt,
      shares: e.shares ?? m.shares,
      debt: e.debt ?? m.debt,
      sharePeriods: e.sharePeriods ?? m.sharePeriods,
      // The file's "not in the report" note was about the file's own report.
      debtStatus: m.debtStatus === NOT_IN_SHARE_REPORT ? null : m.debtStatus,
      notInShareReport: false,
    };
  });
}
