// Reading the cooperative's list of members who moved to another province —
// เลขสมาชิก → หน่วยงานหักเงิน (the office there that now deducts their pay).
//
// Columns are found by their heading, not their position: the list is kept by
// hand in several shapes (one sheet per province, a combined sheet, the
// checked file the dashboard hands back), and a fixed column would read the
// wrong thing from most of them.
//
// A file with a ยืนยัน column is a checked file: most of its member numbers
// were matched from a name, and only the rows a person ticked are known to be
// the right member. Unticked rows are left out, never guessed at.

import { memberNumberKey } from "./memberNumber";

const MEMBER_HEADINGS = ["เลขสมาชิก", "เลขที่สมาชิก", "รหัสสมาชิก", "memberno", "membernumber"];
const UNIT_HEADINGS = ["หน่วยงานหักเงิน", "หน่วยงานที่หัก", "หน่วยหักเงิน", "หน่วยงานต่างจังหวัด"];
const NAME_HEADINGS = ["ชื่อ", "name"];
const ORIGINAL_HEADINGS = ["สังกัดเดิม"];
const NOTE_HEADINGS = ["หมายเหตุ", "note"];
const CONFIRM_HEADINGS = ["ยืนยัน", "confirm"];

const MAX_HEADER_SCAN = 20;

// What counts as ticked: a check mark, or a plain yes typed by hand.
const TICKS = new Set(["✓", "✔", "☑", "✅", "y", "yes", "x", "1", "true", "ใช่", "ยืนยัน", "/"]);

export interface OutOfProvinceRow {
  memberNumber: string;
  memberName: string | null;
  deductingUnit: string;
  originalUnit: string | null;
  note: string | null;
  rowNumber: number;
}

export interface OutOfProvinceProblem {
  rowNumber: number;
  reason: string;
}

export interface OutOfProvinceSheet {
  rows: OutOfProvinceRow[];
  problems: OutOfProvinceProblem[];
  // Rows left out because nobody ticked ยืนยัน — only in a checked file.
  unconfirmed: number;
  blankRows: number;
  hasConfirmColumn: boolean;
}

export class OutOfProvinceSheetError extends Error {}

const normalizeHeading = (value: unknown): string =>
  String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "");

const findColumn = (header: unknown[], headings: string[]): number =>
  header.findIndex((cell) => {
    const text = normalizeHeading(cell);
    return text !== "" && headings.some((heading) => text.includes(heading));
  });

const cellText = (value: unknown): string =>
  value === null || value === undefined
    ? ""
    : String(value)
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\.0+$/, "");

export const isTicked = (value: unknown): boolean => TICKS.has(cellText(value).toLowerCase());

export function parseOutOfProvinceSheet(rows: unknown[][]): OutOfProvinceSheet {
  let headerIndex = -1;
  let memberColumn = -1;
  let unitColumn = -1;
  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN); i++) {
    const member = findColumn(rows[i] ?? [], MEMBER_HEADINGS);
    const unit = findColumn(rows[i] ?? [], UNIT_HEADINGS);
    if (member !== -1 && unit !== -1) {
      headerIndex = i;
      memberColumn = member;
      unitColumn = unit;
      break;
    }
  }
  if (headerIndex === -1) {
    throw new OutOfProvinceSheetError(
      'ไม่พบหัวตารางในไฟล์นี้ — ต้องมีคอลัมน์ที่หัวเขียนว่า "เลขสมาชิก" และ "หน่วยงานหักเงิน" ' +
        "(อยู่คอลัมน์ไหนก็ได้ ระบบหาจากชื่อหัวตาราง)"
    );
  }

  const header = rows[headerIndex];
  const nameColumn = findColumn(header, NAME_HEADINGS);
  const originalColumn = findColumn(header, ORIGINAL_HEADINGS);
  const noteColumn = findColumn(header, NOTE_HEADINGS);
  const confirmColumn = findColumn(header, CONFIRM_HEADINGS);
  const optional = (row: unknown[], column: number) =>
    column === -1 ? null : cellText(row[column]) || null;

  const parsed: OutOfProvinceRow[] = [];
  const problems: OutOfProvinceProblem[] = [];
  let unconfirmed = 0;
  let blankRows = 0;

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowNumber = i + 1;
    const memberRaw = cellText(row[memberColumn]);
    // "ชัยภูมิ1" and "ชัยภูมิ 1" are one office; spacing is not a difference.
    const unit = cellText(row[unitColumn]).replace(/([^\s\d])(\d+)$/, "$1 $2");
    if (!memberRaw && !unit) {
      blankRows++;
      continue;
    }
    if (confirmColumn !== -1 && !isTicked(row[confirmColumn])) {
      unconfirmed++;
      continue;
    }
    const label = optional(row, nameColumn) ?? `แถว ${rowNumber}`;
    if (!memberRaw) {
      problems.push({ rowNumber, reason: `${label}: ไม่มีเลขสมาชิก` });
      continue;
    }
    const memberNumber = memberNumberKey(memberRaw);
    if (!memberNumber || !/^\d+$/.test(memberNumber)) {
      problems.push({ rowNumber, reason: `${label}: เลขสมาชิก "${memberRaw}" ไม่ใช่ตัวเลข` });
      continue;
    }
    if (!unit) {
      problems.push({ rowNumber, reason: `${label} (${memberNumber}): ไม่มีหน่วยงานหักเงิน` });
      continue;
    }
    // The checked file joins the offices a member was listed under in
    // different sheets with " | " — one of them is right, and only a person
    // can say which.
    if (unit.includes("|")) {
      problems.push({
        rowNumber,
        reason: `${label} (${memberNumber}): มีหลายหน่วยงานหักเงิน "${unit}" — แก้ให้เหลือหน่วยงานเดียว`,
      });
      continue;
    }
    parsed.push({
      memberNumber,
      memberName: optional(row, nameColumn),
      deductingUnit: unit,
      originalUnit: optional(row, originalColumn),
      note: optional(row, noteColumn),
      rowNumber,
    });
  }

  return { rows: parsed, problems, unconfirmed, blankRows, hasConfirmColumn: confirmColumn !== -1 };
}

// One member with two different offices in the same file. The file cannot
// say which is current, so the import is refused rather than letting the
// later row silently win.
export function findUnitConflicts(
  rows: OutOfProvinceRow[]
): { memberNumber: string; units: string[] }[] {
  const unitsOf = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = unitsOf.get(row.memberNumber) ?? new Set<string>();
    set.add(row.deductingUnit);
    unitsOf.set(row.memberNumber, set);
  }
  return [...unitsOf]
    .filter(([, units]) => units.size > 1)
    .map(([memberNumber, units]) => ({ memberNumber, units: [...units] }));
}

// The same member listed twice for the same office — one sheet per province
// plus a combined sheet does this — kept once, the first row's details.
export function dedupeByMember(rows: OutOfProvinceRow[]): OutOfProvinceRow[] {
  const seen = new Map<string, OutOfProvinceRow>();
  for (const row of rows) if (!seen.has(row.memberNumber)) seen.set(row.memberNumber, row);
  return [...seen.values()];
}
