// Reading the cooperative's own member list into MemberRoster.
//
// The roster is the record everything else checks against: the bot verifies a
// member number here, the reconciliation reads the name and unit from here,
// and the identity lookup compares เลขบัตรประชาชน and เบอร์โทร from here. Until
// now it could only be filled by a script run from somebody's own machine
// (scripts/import-org-data.ts, scripts/import-national-id-phone.ts), so in
// practice it was filled once and then drifted, and the panel shows members
// with "—" in every column.
//
// Columns are found by their heading, never by position — the same rule as
// lib/bankAccountSheet.ts and for the same reason. Every one of these sheets
// is kept by hand in a different order, and a fixed index quietly reads
// somebody's ID card number into the phone column. If the two required
// headings cannot be found, the import refuses rather than guessing.
//
// Two things this deliberately never reads:
//
//   lineUserId — it belongs to the bot. submitMemberInfo binds a roster row to
//   a LINE account the first time that member identifies themselves, and that
//   binding is the impersonation guard. A stale value from a spreadsheet does
//   not merely fail to help: the guard sees a binding that does not match the
//   account the member is messaging from and refuses their transaction. See
//   the comment in scripts/import-org-data.ts for the outage this caused.
//
//   Anything from the หักไม่ได้ sheet. That file carries เลขประชาชน in column H
//   and this app has never read it. This import is for a member list the
//   cooperative maintains for the purpose, not for that one.

import { memberNumberKey } from "./memberNumber";
import { parseNationalId, parsePhone } from "./identityFormat";

// Matched as substrings against the header cell with spaces removed, so
// "เลขที่ สมาชิก" and "เลขสมาชิก" both land.
const MEMBER_HEADINGS = ["เลขสมาชิก", "เลขที่สมาชิก", "รหัสสมาชิก", "memberno", "membernumber"];
const NAME_HEADINGS = ["ชื่อสมาชิก", "ชื่อ-สกุล", "ชื่อสกุล", "ชื่อ", "membername", "name"];
const UNIT_HEADINGS = ["สังกัด", "หน่วยงาน", "หน่วยคุม", "unit"];
const NATIONAL_ID_HEADINGS = ["เลขบัตรประชาชน", "เลขประจำตัวประชาชน", "บัตรประชาชน", "nationalid"];
const PHONE_HEADINGS = ["เบอร์โทร", "โทรศัพท์", "เบอร์ติดต่อ", "phone", "tel"];

// These sheets often open with a title and a blank line or two; past this it
// is not a header, it is a data row that happens to contain the word.
const MAX_HEADER_SCAN = 20;

export interface MemberRosterRow {
  memberNumber: string;
  memberName: string;
  unitName: string | null;
  nationalId: string | null;
  phone: string | null;
  // Position in the rows handed to this function, counting from 1. Close to
  // the spreadsheet's own row number but not promised to equal it — the
  // reader drops fully empty rows first — so every problem names the member
  // too, which is what staff actually search the file by.
  rowNumber: number;
}

export interface MemberRosterSheetProblem {
  rowNumber: number;
  reason: string;
}

export interface MemberRosterSheet {
  rows: MemberRosterRow[];
  problems: MemberRosterSheetProblem[];
  // Rows where both required fields were empty: trailing blanks, spacer rows,
  // a subtotal line. Counted, not reported — they are not mistakes.
  blankRows: number;
  // Which optional columns the file actually carried, so the result can say
  // "this file had no phone column" instead of leaving staff to wonder why
  // nothing was filled in.
  columns: {
    unit: boolean;
    nationalId: boolean;
    phone: boolean;
  };
}

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
        .trim()
        // Excel hands back a number for a numeric member column, and a long
        // one arrives as "30051.0".
        .replace(/\.0+$/, "");

export class MemberRosterSheetError extends Error {}

export function parseMemberRosterSheet(rows: unknown[][]): MemberRosterSheet {
  let headerIndex = -1;
  let memberColumn = -1;
  let nameColumn = -1;

  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN); i++) {
    const member = findColumn(rows[i] ?? [], MEMBER_HEADINGS);
    const name = findColumn(rows[i] ?? [], NAME_HEADINGS);
    if (member !== -1 && name !== -1) {
      headerIndex = i;
      memberColumn = member;
      nameColumn = name;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new MemberRosterSheetError(
      'ไม่พบหัวตารางในไฟล์นี้ — ต้องมีคอลัมน์ที่หัวเขียนว่า "เลขสมาชิก" และ "ชื่อ" ' +
        "(อยู่คอลัมน์ไหนก็ได้ ระบบหาจากชื่อหัวตาราง ไม่ได้ยึดตำแหน่ง)"
    );
  }

  const header = rows[headerIndex] ?? [];
  const unitColumn = findColumn(header, UNIT_HEADINGS);
  const nationalIdColumn = findColumn(header, NATIONAL_ID_HEADINGS);
  const phoneColumn = findColumn(header, PHONE_HEADINGS);

  const parsed: MemberRosterRow[] = [];
  const problems: MemberRosterSheetProblem[] = [];
  let blankRows = 0;

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowNumber = i + 1;
    const memberRaw = cellText(row[memberColumn]);
    const nameRaw = cellText(row[nameColumn]);

    if (!memberRaw && !nameRaw) {
      blankRows++;
      continue;
    }
    if (!memberRaw) {
      problems.push({ rowNumber, reason: `"${nameRaw}" ไม่มีเลขสมาชิกกำกับ` });
      continue;
    }
    if (!nameRaw) {
      problems.push({ rowNumber, reason: `เลขสมาชิก ${memberRaw} ไม่มีชื่อ` });
      continue;
    }

    // A value that fails its format is dropped and reported, never guessed at
    // and never written. The goal is "this member cannot be identity-verified
    // yet", which is safe; "verified against the wrong number" is not.
    const nationalIdRaw = nationalIdColumn === -1 ? "" : cellText(row[nationalIdColumn]);
    const nationalId = parseNationalId(nationalIdRaw);
    if (nationalIdRaw && !nationalId) {
      problems.push({
        rowNumber,
        reason: `เลขสมาชิก ${memberRaw}: เลขบัตรประชาชนไม่ใช่ 13 หลัก — ข้ามช่องนี้ไว้`,
      });
    }

    const phoneRaw = phoneColumn === -1 ? "" : cellText(row[phoneColumn]);
    const phone = parsePhone(phoneRaw);
    if (phoneRaw && !phone) {
      problems.push({
        rowNumber,
        reason: `เลขสมาชิก ${memberRaw}: เบอร์โทร "${phoneRaw}" ไม่ใช่เบอร์ 9-10 หลัก — ข้ามช่องนี้ไว้`,
      });
    }

    parsed.push({
      memberNumber: memberNumberKey(memberRaw) ?? memberRaw,
      memberName: nameRaw,
      unitName: unitColumn === -1 ? null : cellText(row[unitColumn]) || null,
      nationalId,
      phone,
      rowNumber,
    });
  }

  return {
    rows: parsed,
    problems,
    blankRows,
    columns: {
      unit: unitColumn !== -1,
      nationalId: nationalIdColumn !== -1,
      phone: phoneColumn !== -1,
    },
  };
}

// The same member number twice in one file. The last row would win silently,
// so it is reported instead — usually two people typed into the same sheet, or
// a member listed under two units.
export function findMemberConflicts(
  rows: MemberRosterRow[]
): { memberNumber: string; names: string[] }[] {
  const names = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = names.get(row.memberNumber) ?? new Set<string>();
    set.add(row.memberName);
    names.set(row.memberNumber, set);
  }

  return [...names.entries()]
    .filter(([, found]) => found.size > 1)
    .map(([memberNumber, found]) => ({ memberNumber, names: [...found].sort() }))
    .sort((a, b) => a.memberNumber.localeCompare(b.memberNumber));
}

// The last row for each member number, so a file repeating a member writes
// once. Order is preserved from the file, which is the order problems were
// reported in.
export function dedupeByMember(rows: MemberRosterRow[]): MemberRosterRow[] {
  const byMember = new Map<string, MemberRosterRow>();
  for (const row of rows) byMember.set(row.memberNumber, row);
  return [...byMember.values()];
}
