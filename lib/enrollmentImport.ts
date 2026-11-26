// Importing a list of applicants into the register (lib/enrollment.ts).
//
// The associations and the insurer send their lists of a round's new
// applicants as spreadsheets: "เลขสมาชิก สอ.", the name, the round ("11/69"),
// the amount to collect. Relatives are listed under the member's number with
// a letter in front of it — ม29477 for 29477's mother — and join as
// ฌาปนกิจญาติ of that member.
//
// Nothing is written until staff have seen the plan: who will be recorded,
// and who will not and why — already recorded, already in the yearly file,
// not a member, or a name that does not match the member with that number
// (a typed-wrong number would otherwise put someone else's application, and
// someone else's deduction, on a member).

import { isPlausibleMemberNumber, memberNumberKey } from "./memberNumber";
import type { EnrollmentProduct } from "./enrollment";

export class ApplicantSheetError extends Error {}

export interface ApplicantRow {
  rowNumber: number;
  memberNumber: string;
  // The letter in front of the number for a relative ("ม" in ม29477).
  relativeMark: string | null;
  name: string | null;
  round: string | null;
  amount: number | null;
  insuredSum: number | null;
  annualPremium: number | null;
}

const norm = (v: unknown) =>
  String(v ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

const text = (v: unknown): string | null => {
  const s = String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return s || null;
};

function findCol(header: string[], names: string[], exact = false): number {
  for (const name of names) {
    const n = norm(name);
    const i = header.findIndex((h) => (exact ? h === n : h.startsWith(n)));
    if (i >= 0) return i;
  }
  return -1;
}

export function parseApplicantSheet(pages: unknown[][][]): { rows: ApplicantRow[]; hasLifeColumns: boolean } {
  for (const sheet of pages) {
    for (let h = 0; h < Math.min(sheet.length, 10); h++) {
      const header = (sheet[h] ?? []).map(norm);
      // "เลขสมาชิก สอ." — never the association's own number (เลขฌาปนกิจ).
      const member = header.findIndex((c) => c.startsWith("เลขสมาชิก") || c.startsWith("เลขที่สมาชิก") || c === "ทะเบียนสมาชิก");
      if (member < 0) continue;
      const fullName = findCol(header, ["ชื่อ-นามสกุล", "ชื่อ-สกุล", "ชื่อสกุล"], true);
      const title = findCol(header, ["คำนำหน้า"]);
      const first = findCol(header, ["ชื่อ"], true);
      const last = findCol(header, ["สกุล", "นามสกุล"], true);
      const round = findCol(header, ["รอบ"], true);
      const amount = findCol(header, ["จำนวนเรียกเก็บ", "ยอดเรียกเก็บ"]);
      const insured = findCol(header, ["วงเงินคุ้มครอง", "ทุนประกัน"]);
      const premium = findCol(header, ["เบี้ยประกัน"]);

      const rows: ApplicantRow[] = [];
      for (let r = h + 1; r < sheet.length; r++) {
        const row = sheet[r] ?? [];
        const raw = String(row[member] ?? "").replace(/\s+/g, "");
        const m = /^([฀-๿]*)(\d+)(?:\.0+)?$/.exec(raw);
        if (!m) continue; // blank, or the total line
        const memberNumber = memberNumberKey(m[2]);
        if (!memberNumber || !isPlausibleMemberNumber(memberNumber)) continue;
        const name =
          (fullName >= 0 ? text(row[fullName]) : null) ??
          text([title, first, last].filter((i) => i >= 0).map((i) => row[i] ?? "").join(" "));
        rows.push({
          rowNumber: r + 1,
          memberNumber,
          relativeMark: m[1] || null,
          name,
          round: round >= 0 ? text(row[round]) : null,
          amount: amount >= 0 ? num(row[amount]) : null,
          insuredSum: insured >= 0 ? num(row[insured]) : null,
          annualPremium: premium >= 0 ? num(row[premium]) : null,
        });
      }
      return { rows, hasLifeColumns: insured >= 0 && premium >= 0 };
    }
  }
  throw new ApplicantSheetError('ไม่พบหัวคอลัมน์ "เลขสมาชิก" ในไฟล์');
}

// "11/69", "11/2569", "3/70" — the month an association's round starts, as
// the first of that month. Two-digit years are Buddhist years after 2500.
export function roundDate(round: string | null): string | null {
  const m = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec(round ?? "");
  if (!m) return null;
  const month = Number(m[1]);
  let year = Number(m[2]);
  if (month < 1 || month > 12) return null;
  if (year < 100) year += 2500;
  if (year > 2400) year -= 543;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

// Titles and spaces aside, so "นางสาว อภิญญา  พิเภก" matches "อภิญญา พิเภก".
const TITLES = /^(ว่าที่\s*(ร้อย|เรือ|เรืออากาศ)?\s*(ตรี|โท|เอก)?\s*(หญิง)?|นางสาว|นาง|นาย|น\.ส\.|ด\.ช\.|ด\.ญ\.|ดร\.)/;
export function personKey(name: string | null | undefined): string {
  let s = String(name ?? "")
    .replace(/ํา/g, "ำ")
    .trim();
  for (let i = 0; i < 3; i++) s = s.replace(TITLES, "").trim();
  return s.replace(/[\s.]/g, "");
}

// Lists are typed by hand and spellings drift (ณัฎฐ/ณัฏฐ), so a name only
// counts as someone else's when neither the first name nor the surname
// agrees.
export function samePerson(a: string | null | undefined, b: string | null | undefined): boolean {
  const parts = (n: string | null | undefined) => {
    let s = String(n ?? "").replace(/ํา/g, "ำ").trim();
    for (let i = 0; i < 3; i++) s = s.replace(TITLES, "").trim();
    const words = s.split(/\s+/).filter(Boolean);
    return { first: words[0] ?? "", last: words.length > 1 ? words[words.length - 1] : "", all: words.join("") };
  };
  const x = parts(a);
  const y = parts(b);
  if (!x.all || !y.all) return true;
  return x.all === y.all || (!!x.first && x.first === y.first) || (!!x.last && x.last === y.last);
}

export type PlanAction = "create" | "skip";

export interface PlannedRow extends ApplicantRow {
  product: EnrollmentProduct;
  applicationDate: string | null;
  action: PlanAction;
  reason: string | null;
  rosterName: string | null;
}

export interface PlanContext {
  // The product the file is for; a relative's row becomes "relative".
  product: EnrollmentProduct;
  // Used when the row has no round.
  defaultDate: string | null;
  roster: Map<string, { memberName: string }>;
  // Applications already in the register that are not rejected.
  recorded: { memberNumber: string; product: string; relativeName: string | null }[];
  // Members the current yearly file already shows in this product.
  inYearlyFile: Set<string>;
}

export const SKIP = {
  notMember: "เลขสมาชิกนี้ไม่อยู่ในทะเบียนสมาชิก",
  nameMismatch: "ชื่อไม่ตรงกับสมาชิกเลขนี้ในทะเบียน — เลขสมาชิกอาจพิมพ์ผิด",
  recorded: "บันทึกการสมัครไว้แล้ว",
  inFile: "มีในไฟล์ปีแล้ว",
  noDate: "ไม่มีรอบหรือวันที่สมัคร",
  noLife: "ไม่มีทุนประกันหรือเบี้ยประกันในแถวนี้",
  repeated: "ซ้ำในไฟล์",
} as const;

export function planApplicants(rows: ApplicantRow[], ctx: PlanContext): PlannedRow[] {
  const seen = new Set<string>();
  const recorded = new Set(
    ctx.recorded.map((r) => `${r.memberNumber}|${r.product}|${r.product === "relative" ? personKey(r.relativeName) : ""}`)
  );
  return rows.map((row) => {
    const relative = !!row.relativeMark;
    const product: EnrollmentProduct = relative ? "relative" : ctx.product;
    const applicationDate = roundDate(row.round) ?? ctx.defaultDate;
    const member = ctx.roster.get(row.memberNumber);
    const out = (action: PlanAction, reason: string | null = null): PlannedRow => ({
      ...row,
      product,
      applicationDate,
      action,
      reason,
      rosterName: member?.memberName ?? null,
    });

    const key = `${row.memberNumber}|${product}|${relative ? personKey(row.name) : ""}`;
    if (seen.has(key)) return out("skip", SKIP.repeated);
    seen.add(key);
    if (!member) return out("skip", SKIP.notMember);
    // A relative's name is the relative's own, not the member's.
    if (!relative && row.name && !samePerson(row.name, member.memberName)) {
      return out("skip", SKIP.nameMismatch);
    }
    if (recorded.has(key)) return out("skip", SKIP.recorded);
    if (!relative && ctx.inYearlyFile.has(row.memberNumber)) return out("skip", SKIP.inFile);
    if (!applicationDate) return out("skip", SKIP.noDate);
    if (product === "life" && !(row.insuredSum! > 0 && row.annualPremium! > 0)) return out("skip", SKIP.noLife);
    return out("create");
  });
}
