// สสค. — the cremation association whose member list comes out of its own
// system as a tab-separated text file in Thai Windows encoding, named .xls:
//
//   คำนำหน้า  ชื่อ  สกุล  ทะเบียน สมาคม  ทะเบียน สหกรณ์  เลขบัตรประชาชน
//   สถานะ  วันที่ลาออก  งวดส่งรายเดือน  ยอดส่งรายเดือน  ยอดคงเหลือ
//
// สถานะ 0 is a current member (paying monthly, 450 in 2569), 1 one who has
// left. The list holds members' relatives too, under the member's
// cooperative number — a mother, a spouse — and people with no cooperative
// number at all.
//
// For the coverage tab only the member's own membership counts (as for the
// other four associations: a relative's pays the relative's family), so a
// row counts when it is current, its cooperative number is a member, and its
// first name is that member's first name. Everything else is counted and
// reported, not used.

import { isPlausibleMemberNumber, memberNumberKey } from "./memberNumber";

export class SscFileError extends Error {}

export interface SscRow {
  title: string;
  firstName: string;
  lastName: string;
  assocNumber: string;
  memberNumber: string | null;
  active: boolean;
  lastPeriod: string | null;
  monthly: number | null;
}

const HEADINGS = ["ชื่อ", "สกุล", "ทะเบียน สหกรณ์", "สถานะ"];

// Undo the quoting of one tab-separated line.
function cells(line: string): string[] {
  return line.split("\t").map((c) => c.replace(/^"([\s\S]*)"$/, "$1").replace(/""/g, '"').trim());
}

export function parseSscText(text: string): SscRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new SscFileError("ไฟล์ว่าง");
  const header = cells(lines[0]);
  const col = (name: string) => header.findIndex((h) => h.replace(/\s+/g, "") === name.replace(/\s+/g, ""));
  if (HEADINGS.some((h) => col(h) < 0)) {
    throw new SscFileError('ไม่พบหัวคอลัมน์ "ชื่อ" "สกุล" "ทะเบียน สหกรณ์" "สถานะ" — ใช้ไฟล์รายชื่อที่ส่งออกจากระบบ สสค.');
  }
  const at = {
    title: col("คำนำหน้า"),
    first: col("ชื่อ"),
    last: col("สกุล"),
    assoc: col("ทะเบียน สมาคม"),
    member: col("ทะเบียน สหกรณ์"),
    status: col("สถานะ"),
    period: col("งวดส่งรายเดือน"),
    monthly: col("ยอดส่งรายเดือน"),
  };
  return lines.slice(1).map((line) => {
    const c = cells(line);
    const digits = (c[at.member] ?? "").replace(/\D/g, "");
    const key = digits && Number(digits) > 0 ? memberNumberKey(digits) : null;
    const period = at.period >= 0 ? c[at.period] : "";
    const monthly = at.monthly >= 0 ? Number(c[at.monthly]) : NaN;
    return {
      title: at.title >= 0 ? (c[at.title] ?? "") : "",
      firstName: c[at.first] ?? "",
      lastName: c[at.last] ?? "",
      assocNumber: at.assoc >= 0 ? (c[at.assoc] ?? "") : "",
      memberNumber: key && isPlausibleMemberNumber(key) ? key : null,
      active: (c[at.status] ?? "") === "0",
      lastPeriod: /^\d{6}$/.test(period) && period !== "000000" ? period : null,
      monthly: Number.isFinite(monthly) && monthly > 0 ? monthly : null,
    };
  });
}

// A first name as the two sources write it: no title, no maiden name in
// brackets, no spaces.
const TITLES = /^(ว่าที่\s*(ร้อย|เรือ|เรืออากาศ)?\s*(ตรี|โท|เอก)?\s*(หญิง)?|นางสาว|นาง|นาย|น\.ส\.|ดร\.)/;
export function firstNameOf(full: string): string {
  let s = full.replace(/ํา/g, "ำ").trim();
  for (let i = 0; i < 3; i++) s = s.replace(TITLES, "").trim();
  return bare(s.split(/\s+/)[0] ?? "");
}
const bare = (s: string) => s.replace(/\(.*?\)/g, "").replace(/\s+/g, "").replace(/ํา/g, "ำ");

export interface SscOwn {
  memberNumber: string;
  assocNumber: string;
  name: string;
  lastPeriod: string | null;
  monthly: number | null;
}

export interface SscClassified {
  own: SscOwn[];
  counts: {
    rows: number;
    left: number;
    relatives: number;
    noMemberNumber: number;
    notMember: number;
    // Current rows with no monthly payment on record.
    notPaying: number;
  };
}

export function classifySsc(rows: SscRow[], members: Map<string, string>): SscClassified {
  const own = new Map<string, SscOwn>();
  const counts = { rows: rows.length, left: 0, relatives: 0, noMemberNumber: 0, notMember: 0, notPaying: 0 };
  for (const r of rows) {
    if (!r.active) {
      counts.left++;
      continue;
    }
    if (!r.memberNumber) {
      counts.noMemberNumber++;
      continue;
    }
    const name = members.get(r.memberNumber);
    if (name == null) {
      counts.notMember++;
      continue;
    }
    if (bare(r.firstName) !== firstNameOf(name)) {
      counts.relatives++;
      continue;
    }
    if (!r.monthly) counts.notPaying++;
    if (!own.has(r.memberNumber)) {
      own.set(r.memberNumber, {
        memberNumber: r.memberNumber,
        assocNumber: r.assocNumber,
        name: `${r.title}${r.firstName} ${r.lastName}`.trim(),
        lastPeriod: r.lastPeriod,
        monthly: r.monthly,
      });
    }
  }
  return { own: [...own.values()], counts };
}
