// Reading the ประกันและหลักประกัน workbook (สมาชิกทำประกันและฌาปนกิจ_2570.xlsx,
// sheet "รายชื่อ") into MemberCoverage rows.
//
// Columns are found by heading, never by position, the same rule as
// lib/bankAccountSheet.ts: the workbook is rebuilt by hand every year and
// gains columns as questions get asked of it. The workbook also carries
// summary sheets in front of the list, so the sheet is chosen by its headings
// too — the first one that has a member-number column and a debt or insured
// sum column.

import { memberNumberKey, isPlausibleMemberNumber } from "./memberNumber";
import type { CoverageInput } from "./coverage";

export class CoverageSheetError extends Error {}

const norm = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");

// Each field and the headings that name it. Matched exactly first, then as a
// prefix, so "อายุ" does not swallow "อายุสมาชิก (งวด)".
const FIELDS: Record<string, string[]> = {
  memberNumber: ["เลขสมาชิก", "ทะเบียนสมาชิก"],
  memberName: ["ชื่อ-สกุล", "ชื่อ-นามสกุล", "ชื่อ"],
  unitName: ["หน่วยงาน", "สังกัด"],
  gender: ["เพศ"],
  age: ["อายุ"],
  sharePeriods: ["อายุสมาชิก(งวด)", "งวดหุ้น", "อายุสมาชิก"],
  shares: ["หุ้น", "ทุนเรือนหุ้น"],
  debt: ["หนี้รวม", "หนี้"],
  insuredSum: ["ทุนประกัน"],
  premium: ["เบี้ยประกัน"],
  premiumDeducted: ["ประกัน(หักจากปันผล)"],
  sok: ["สสอค."],
  scs: ["สส.ชสอ."],
  sst: ["สส.สท."],
  ssk: ["สส.สก."],
  relativeCount: ["ญาติ(ราย)"],
  relativeFees: ["ค่าบำรุงญาติรวม"],
  debtStatus: ["สถานะหนี้"],
  undeducted: ["รายการที่หักไม่ได้"],
};

const REQUIRED = ["memberNumber", "insuredSum"];

const MAX_HEADER_SCAN = 10;

function findColumns(header: unknown[]): Record<string, number> | null {
  const cells = header.map(norm);
  const cols: Record<string, number> = {};
  const used = new Set<number>();
  // Exact matches first so a short heading cannot claim a longer column.
  for (const pass of ["exact", "prefix"] as const) {
    for (const [field, names] of Object.entries(FIELDS)) {
      if (field in cols) continue;
      for (const name of names) {
        const n = norm(name);
        const idx = cells.findIndex((c, i) => !used.has(i) && (pass === "exact" ? c === n : c.startsWith(n)));
        if (idx >= 0) {
          cols[field] = idx;
          used.add(idx);
          break;
        }
      }
    }
  }
  return REQUIRED.every((f) => f in cols) ? cols : null;
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

const text = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

// An association column holds the yearly fee when the member belongs, and is
// empty when they do not. Zero is "does not belong" too.
const belongs = (v: unknown) => (num(v) ?? 0) > 0;

export interface CoverageSheet {
  rows: CoverageInput[];
  problems: { rowNumber: number; reason: string }[];
  sheetIndex: number;
}

export function pickCoverageSheet(sheets: unknown[][][]): { index: number; headerRow: number; cols: Record<string, number> } {
  for (let s = 0; s < sheets.length; s += 1) {
    const rows = sheets[s];
    for (let r = 0; r < Math.min(rows.length, MAX_HEADER_SCAN); r += 1) {
      const cols = findColumns(rows[r] ?? []);
      if (cols) return { index: s, headerRow: r, cols };
    }
  }
  throw new CoverageSheetError(
    "ไม่พบชีตรายชื่อ — ต้องมีหัวคอลัมน์อย่างน้อย \"เลขสมาชิก\" และ \"ทุนประกัน\""
  );
}

export function parseCoverageSheet(sheets: unknown[][][]): CoverageSheet {
  const { index, headerRow, cols } = pickCoverageSheet(sheets);
  const rows = sheets[index];
  const get = (row: unknown[], field: string) => (field in cols ? row[cols[field]] : undefined);
  const out: CoverageInput[] = [];
  const problems: { rowNumber: number; reason: string }[] = [];
  const seen = new Set<string>();

  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const rowNumber = r + 1;
    const rawMember = text(get(row, "memberNumber"));
    if (!rawMember) continue;
    const key = memberNumberKey(rawMember.replace(/\.0+$/, ""));
    if (!key || !isPlausibleMemberNumber(key)) continue; // a total line
    if (seen.has(key)) {
      problems.push({ rowNumber, reason: `เลขสมาชิก ${key} ซ้ำ — ใช้แถวแรก` });
      continue;
    }
    seen.add(key);

    const deducted = text(get(row, "premiumDeducted"));
    const debt = num(get(row, "debt"));
    const age = num(get(row, "age"));
    const periods = num(get(row, "sharePeriods"));

    out.push({
      memberNumber: key,
      memberName: text(get(row, "memberName")),
      unitName: text(get(row, "unitName")),
      gender: text(get(row, "gender")),
      age: age == null ? null : Math.trunc(age),
      sharePeriods: periods == null ? null : Math.trunc(periods),
      shares: num(get(row, "shares")) ?? 0,
      debt,
      insuredSum: Math.round(num(get(row, "insuredSum")) ?? 0),
      premium: Math.round(num(get(row, "premium")) ?? 0),
      premiumDeducted: deducted == null ? null : deducted.includes("ไม่ได้") ? false : deducted.includes("ได้") ? true : null,
      hasSok: belongs(get(row, "sok")),
      hasScs: belongs(get(row, "scs")),
      hasSst: belongs(get(row, "sst")),
      hasSsk: belongs(get(row, "ssk")),
      relativeCount: Math.trunc(num(get(row, "relativeCount")) ?? 0),
      relativeFees: Math.round(num(get(row, "relativeFees")) ?? 0),
      debtStatus: text(get(row, "debtStatus")) ?? (debt == null && "debt" in cols ? "ไม่มีในรายงานหุ้นหนี้" : null),
      undeducted: text(get(row, "undeducted")),
    });
  }

  if (out.length === 0) throw new CoverageSheetError("ชีตรายชื่อไม่มีข้อมูลสมาชิก");
  return { rows: out, problems, sheetIndex: index };
}
