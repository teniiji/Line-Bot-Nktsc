// Reading a "member number → bank account" sheet.
//
// The directory this fills was only ever built one row at a time, as staff
// resolved transfers the หักไม่ได้ sheet could not place. That makes it as
// complete as the hours somebody has spent on it — which is why the daily
// reconciliation's strongest evidence, "the directory says this account is
// theirs", is available for so few payments.
//
// The cooperative already holds the same information in a spreadsheet. This
// reads it.
//
// Columns are found by their heading, never by position. Every one of these
// sheets is maintained by hand, in a different order, with a different number
// of leading columns; a fixed index reads somebody's ID card number as an
// account number and binds it silently. If the headings cannot be found the
// import refuses rather than guessing.

import { normalizeAccountNumber } from "./statementReconcile";

// Words that identify each column. Matched as substrings against the header
// cell with spaces removed, so "เลขที่ บัญชี" and "เลขบัญชีธนาคาร" both land.
const MEMBER_HEADINGS = ["เลขสมาชิก", "เลขที่สมาชิก", "รหัสสมาชิก", "memberno", "membernumber"];
const ACCOUNT_HEADINGS = ["เลขบัญชี", "เลขที่บัญชี", "บัญชีธนาคาร", "accountno", "accountnumber"];
const NAME_HEADINGS = ["ชื่อ", "ชื่อสกุล", "ชื่อ-สกุล", "name"];

// How far into the file to look for the heading row. These sheets often open
// with a title and a blank line or two; past this it is not a header, it is a
// data row that happens to contain the word.
const MAX_HEADER_SCAN = 20;

export interface BankAccountRow {
  memberNumber: string;
  accountNumber: string;
  memberName: string | null;
  // Position in the rows handed to this function, counting from 1. Close to
  // the spreadsheet's own row number but not promised to equal it: the reader
  // drops fully empty rows before this sees them, so anything below a gap is
  // off by the size of the gap. Every problem message therefore names the
  // member or account too, which is what staff actually search the file by.
  rowNumber: number;
}

export interface BankAccountSheetProblem {
  rowNumber: number;
  reason: string;
}

export interface BankAccountSheet {
  rows: BankAccountRow[];
  problems: BankAccountSheetProblem[];
  // Rows where both fields were empty: trailing blanks, spacer rows, a
  // subtotal line. Counted, not reported — they are not mistakes.
  blankRows: number;
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
        // one arrives as "30051.0" or in exponential form.
        .replace(/\.0+$/, "");

export class BankAccountSheetError extends Error {}

export function parseBankAccountSheet(rows: unknown[][]): BankAccountSheet {
  let headerIndex = -1;
  let memberColumn = -1;
  let accountColumn = -1;

  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN); i++) {
    const member = findColumn(rows[i] ?? [], MEMBER_HEADINGS);
    const account = findColumn(rows[i] ?? [], ACCOUNT_HEADINGS);
    if (member !== -1 && account !== -1) {
      headerIndex = i;
      memberColumn = member;
      accountColumn = account;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new BankAccountSheetError(
      'ไม่พบหัวตารางในไฟล์นี้ — ต้องมีคอลัมน์ที่หัวเขียนว่า "เลขสมาชิก" และ "เลขบัญชี" ' +
        "(อยู่คอลัมน์ไหนก็ได้ ระบบหาจากชื่อหัวตาราง ไม่ได้ยึดตำแหน่ง)"
    );
  }

  // Optional: only used to fill in a name for a member the roster has never
  // heard of, so its absence is not a problem.
  const nameColumn = findColumn(rows[headerIndex], NAME_HEADINGS);

  const parsed: BankAccountRow[] = [];
  const problems: BankAccountSheetProblem[] = [];
  let blankRows = 0;

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const rowNumber = i + 1;
    const memberRaw = cellText(row[memberColumn]);
    const accountRaw = cellText(row[accountColumn]);

    if (!memberRaw && !accountRaw) {
      blankRows++;
      continue;
    }

    // Half a row is reported rather than skipped: a member with no account is
    // exactly the member staff are trying to find, and knowing the sheet has
    // a hole is the point of importing it.
    if (!memberRaw) {
      problems.push({ rowNumber, reason: `เลขบัญชี ${accountRaw} ไม่มีเลขสมาชิกกำกับ` });
      continue;
    }
    if (!accountRaw) {
      problems.push({ rowNumber, reason: `เลขสมาชิก ${memberRaw} ไม่มีเลขบัญชี` });
      continue;
    }

    const accountNumber = normalizeAccountNumber(accountRaw);
    if (!accountNumber) {
      problems.push({
        rowNumber,
        reason: `เลขสมาชิก ${memberRaw}: เลขบัญชี "${accountRaw}" ไม่มีตัวเลขเลย`,
      });
      continue;
    }

    parsed.push({
      memberNumber: memberRaw,
      accountNumber,
      memberName: nameColumn === -1 ? null : cellText(row[nameColumn]) || null,
      rowNumber,
    });
  }

  return { rows: parsed, problems, blankRows };
}

// One account belongs to one member, so a sheet naming the same account twice
// for two different members is a contradiction the file has to answer for —
// importing it would bind the account to whichever row happened to be last.
// The same pair repeated is just a duplicate row and is dropped quietly.
export function findAccountConflicts(
  rows: BankAccountRow[]
): { accountNumber: string; memberNumbers: string[] }[] {
  const owners = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = owners.get(row.accountNumber) ?? new Set<string>();
    set.add(row.memberNumber);
    owners.set(row.accountNumber, set);
  }

  return [...owners.entries()]
    .filter(([, members]) => members.size > 1)
    .map(([accountNumber, members]) => ({
      accountNumber,
      memberNumbers: [...members].sort(),
    }))
    .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
}

// The last row wins for a repeated account/member pair, matching what an
// upsert would do anyway — stated here so the count reported to staff is the
// number of bindings actually written, not the number of rows read.
export function dedupeByAccount(rows: BankAccountRow[]): BankAccountRow[] {
  const byAccount = new Map<string, BankAccountRow>();
  for (const row of rows) byAccount.set(row.accountNumber, row);
  return [...byAccount.values()];
}
