// Reading the cooperative's printed "รายงานหุ้นและหนี้คงเหลือ" PDF.
//
// The report comes out of the cooperative's system as a PDF of some 900
// landscape pages, one line per member: ทะเบียนสมาชิก, ชื่อ, หุ้น/เดือน (the
// number of instalments, then the monthly amount), ทุนเรือนหุ้น, three loan
// groups, รวม and ด/บ สะสม. Further contracts of the same member print on the
// lines below; a member whose contracts run past the page bottom is printed
// again at the top of the next page without totals.
//
// The PDF has no table in it, only text placed on the page, so columns are
// told apart by where each figure ends (the figures are right-aligned). The
// text is drawn turned on its side: x runs down the list, y along a line.
//
// The file is too big to send to the server, so this runs in the browser
// (components/ShareDebtReports.tsx) on what pdf.js reads, and only the
// figures are sent. Nothing is imported unless the members and amounts add up
// to the report's own grand total on its last page — the check that the
// columns were read right.

import { isPlausibleMemberNumber, memberNumberKey } from "./memberNumber";
import type { LoanType, ShareDebtContract, ShareDebtEntry } from "./shareDebt";

export interface PdfTextItem {
  page: number;
  // Down the list (which member).
  x: number;
  // Along the line, where the text starts.
  y: number;
  width: number;
  text: string;
}

export class ShareDebtPdfError extends Error {}

// Where each column's figures end along the line.
const COLUMNS = {
  periods: 254.8,
  monthly: 281.1,
  shares: 340.4,
  emergency: 506.8,
  ordinary: 675.5,
  special: 859.3,
  total: 930.7,
  interest: 1010.1,
} as const;
type Column = keyof typeof COLUMNS;
const MEMBER_END = 90.1;
const TOLERANCE = 6;
// How far apart in x two pieces of one printed line can be.
const SAME_LINE = 4;

const NUMBER = /^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/;
const toNumber = (s: string) => Number(s.replace(/,/g, ""));

function columnOf(item: PdfTextItem): Column | null {
  const end = item.y + item.width;
  let best: Column | null = null;
  let distance = TOLERANCE;
  for (const [c, at] of Object.entries(COLUMNS) as [Column, number][]) {
    const d = Math.abs(end - at);
    if (d <= distance) {
      best = c;
      distance = d;
    }
  }
  return best;
}

// The report's font maps a few Thai marks to control characters.
export function cleanThai(s: string): string {
  return s
    .replace(/\u0016/g, "่")
    .replace(/\u001c/g, "้")
    .replace(/([฀-๿])T/g, "$1้")
    // นิคหิต + (วรรณยุกต์) + า is how the font writes ำ: "ตํ่า" for "ต่ำ".
    .replace(/ํ([่้๊๋]?)า/g, "$1ำ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PdfCheck {
  label: string;
  read: number;
  report: number | null;
  ok: boolean;
}

export interface ShareDebtPdf {
  entries: ShareDebtEntry[];
  checks: PdfCheck[];
  // Every check found its figure in the report and matched it.
  ok: boolean;
  resigned: number;
}

interface Row {
  memberNumber: string;
  name: string | null;
  periods: number | null;
  shares: number | null;
  total: number | null;
  resigned: boolean;
  contracts: ShareDebtContract[];
}

// ---- Contracts ------------------------------------------------------------
// Each loan group prints, per contract: งวด, เลขที่สัญญา, ชำระ/งวด, คงเหลือ.
// A member's further contracts go on the lines below theirs. The figures
// end at fixed places; the contract number starts at one.
const LOAN_GROUPS: { type: LoanType; installment: number; contractStart: number; payment: number; balance: number }[] = [
  { type: "emergency", installment: 355.5, contractStart: 365.5, payment: 452.8, balance: 506.8 },
  { type: "ordinary", installment: 524, contractStart: 534.5, payment: 620.1, balance: 675.5 },
  { type: "special", installment: 690.5, contractStart: 703.8, payment: 794.8, balance: 859.3 },
];
const LINE_STEP = 3;

// The font the report prints contract numbers in maps each digit to another
// character ("สป'*%)3%" is สป601341). The page numbers in the header use the
// same font — "หน้าที่ : % / &&'" on page 1 of 886 — so each file's own
// mapping is read from them.
export function digitCipher(items: PdfTextItem[]): Map<string, string> | null {
  const map = new Map<string, string>();
  // A loop, not Math.max(...): a report is a quarter of a million items.
  let pages = 0;
  for (const i of items) if (i.page > pages) pages = i.page;
  for (const it of items) {
    const m = /:\s*(\S+)\s*\/\s*(\S+)\s*$/.exec(it.text);
    if (!m || !cleanThai(it.text).startsWith("หน้าที")) continue;
    const pairs: [string, string][] = [
      [m[1], String(it.page)],
      [m[2], String(pages)],
    ];
    for (const [shown, real] of pairs) {
      if (shown.length !== real.length) return null;
      for (let i = 0; i < shown.length; i++) {
        const known = map.get(shown[i]);
        if (known != null && known !== real[i]) return null; // not a cipher after all
        map.set(shown[i], real[i]);
      }
    }
  }
  return map.size ? map : null;
}

// Numbers in the cipher font come with a Thai prefix (สป, สด, พอ, ฉฉ); the
// ATxxxxxx emergency contracts are printed in plain digits.
function decodeContract(raw: string, cipher: Map<string, string> | null): string {
  const s = raw.trim();
  if (!cipher || !/[\u0E00-\u0E7F]/.test(s)) return s;
  return [...s].map((ch) => (/[\u0E00-\u0E7F]/.test(ch) ? ch : (cipher.get(ch) ?? ch))).join("");
}

function contractsOnLine(line: PdfTextItem[], cipher: Map<string, string> | null): ShareDebtContract[] {
  const out: ShareDebtContract[] = [];
  for (const g of LOAN_GROUPS) {
    const at = (end: number) =>
      line.find((it) => NUMBER.test(it.text.trim()) && Math.abs(it.y + it.width - end) <= TOLERANCE);
    const balance = at(g.balance);
    if (!balance) continue;
    const contract = line.find((it) => !NUMBER.test(it.text.trim()) && Math.abs(it.y - g.contractStart) <= 8);
    const installment = at(g.installment);
    const payment = at(g.payment);
    out.push({
      type: g.type,
      contractNo: contract ? decodeContract(contract.text, cipher) : null,
      installment: installment ? Math.trunc(toNumber(installment.text.trim())) : null,
      payment: payment ? toNumber(payment.text.trim()) : null,
      balance: toNumber(balance.text.trim()),
    });
  }
  return out;
}

export function parseShareDebtPdf(items: PdfTextItem[]): ShareDebtPdf {
  const byPage = new Map<number, PdfTextItem[]>();
  for (const it of items) {
    if (!it.text.trim()) continue;
    const list = byPage.get(it.page) ?? [];
    list.push(it);
    byPage.set(it.page, list);
  }

  const cipher = digitCipher(items);
  const rows = new Map<string, Row>();
  const order: string[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const pageItems = byPage.get(page)!;
    const anchors = pageItems
      .filter((it) => /^\d{5,8}$/.test(it.text.trim()) && Math.abs(it.y + it.width - MEMBER_END) <= 4)
      .sort((a, b) => a.x - b.x);
    for (const [index, anchor] of anchors.entries()) {
      const memberNumber = memberNumberKey(anchor.text.trim());
      if (!memberNumber || !isPlausibleMemberNumber(memberNumber)) continue;
      const line = pageItems.filter((it) => it !== anchor && Math.abs(it.x - anchor.x) <= SAME_LINE);
      const figures: Partial<Record<Column, number>> = {};
      for (const it of line) {
        const c = columnOf(it);
        if (c && NUMBER.test(it.text.trim())) figures[c] = toNumber(it.text.trim());
      }
      // The lines below, up to the next member: further contracts, unless a
      // unit total or summary (รวม, =, or figures outside the loan columns)
      // comes first.
      const next = anchors[index + 1]?.x ?? Infinity;
      const below = new Map<number, PdfTextItem[]>();
      for (const it of pageItems) {
        if (it.x > anchor.x + SAME_LINE && it.x < next - SAME_LINE) {
          const k = Math.round(it.x / LINE_STEP);
          below.set(k, [...(below.get(k) ?? []), it]);
        }
      }
      const contracts = contractsOnLine(line, cipher);
      for (const k of [...below.keys()].sort((a, b) => a - b)) {
        const l = below.get(k)!;
        const stops = l.some((it) => {
          const t = cleanThai(it.text);
          const c = columnOf(it);
          return t.includes("รวม") || t.includes("=") || c === "total" || c === "interest" || c === "shares" || it.y + it.width < 300;
        });
        if (stops) break;
        contracts.push(...contractsOnLine(l, cipher));
      }

      const nameItem = line.find((it) => it.y > MEMBER_END && it.y < 200 && /[฀-๿]/.test(it.text));
      const row: Row = {
        memberNumber,
        name: nameItem ? cleanThai(nameItem.text) : null,
        periods: figures.periods ?? null,
        shares: figures.shares ?? null,
        total: figures.total ?? null,
        resigned: line.some((it) => it.text.includes("ลาออก")),
        contracts,
      };

      // Printed again at the top of the next page for the rest of its
      // contracts: the first entry, which carries the totals, stands.
      const seen = rows.get(memberNumber);
      if (seen) {
        if (seen.total == null && row.total != null) {
          rows.set(memberNumber, { ...row, name: seen.name ?? row.name, contracts: [...seen.contracts, ...row.contracts] });
        } else {
          seen.contracts.push(...row.contracts);
        }
        continue;
      }
      rows.set(memberNumber, row);
      order.push(memberNumber);
    }
  }

  if (rows.size === 0) {
    throw new ShareDebtPdfError(
      "ไม่พบรายชื่อสมาชิกในไฟล์ PDF — ใช้ได้กับ \"รายงานหุ้นและหนี้คงเหลือ\" ที่พิมพ์จากระบบสหกรณ์เท่านั้น"
    );
  }

  const entries: ShareDebtEntry[] = order.map((n) => {
    const r = rows.get(n)!;
    return {
      memberNumber: r.memberNumber,
      memberName: r.name,
      shares: r.shares,
      debt: r.total ?? 0,
      sharePeriods: r.periods == null ? null : Math.trunc(r.periods),
      contracts: r.contracts,
      resigned: r.resigned,
    };
  });

  const report = grandTotals(items);
  const round2 = (x: number) => Math.round(x * 100) / 100;
  const check = (label: string, read: number, reported: number | null | undefined): PdfCheck => ({
    label,
    read: round2(read),
    report: reported ?? null,
    ok: reported != null && Math.abs(read - reported) < 0.005,
  });
  const checks = [
    check("จำนวนสมาชิก", entries.length, report.members),
    check("สมาชิกที่เป็นหนี้", entries.filter((e) => (e.debt ?? 0) > 0).length, report.inDebt),
    check("ทุนเรือนหุ้น", entries.reduce((s, e) => s + (e.shares ?? 0), 0), report.shares),
    check("หนี้รวม", entries.reduce((s, e) => s + (e.debt ?? 0), 0), report.total),
    ...LOAN_GROUPS.map((g) =>
      check(
        `เงินกู้${{ emergency: "ฉุกเฉิน", ordinary: "สามัญ", special: "พิเศษ" }[g.type]}คงเหลือ (รายสัญญา)`,
        entries.reduce((s, e) => s + (e.contracts ?? []).filter((c) => c.type === g.type).reduce((a, c) => a + c.balance, 0), 0),
        report[g.type]
      )
    ),
  ];
  return {
    entries,
    checks,
    ok: checks.every((c) => c.ok),
    resigned: [...rows.values()].filter((r) => r.resigned).length,
  };
}

// The last page's "รวมทั้งหมด" line and the member counts printed under it.
function grandTotals(items: PdfTextItem[]) {
  const text = (it: PdfTextItem) => cleanThai(it.text);
  const heading = [...items].reverse().find((it) => text(it).startsWith("รวมทั้งหมด"));
  const out: Partial<Record<"members" | "inDebt" | "shares" | "total" | LoanType, number>> = {};
  if (!heading) return out;

  const onPage = items.filter((it) => it.page === heading.page);
  for (const it of onPage) {
    if (Math.abs(it.x - heading.x) > SAME_LINE || !NUMBER.test(it.text.trim())) continue;
    const c = columnOf(it);
    if (c === "shares") out.shares = toNumber(it.text.trim());
    if (c === "total") out.total = toNumber(it.text.trim());
    if (c === "emergency" || c === "ordinary" || c === "special") out[c] = toNumber(it.text.trim());
  }

  // The counts sit on their own lines below it, the figure first on the line.
  const countFor = (label: (s: string) => boolean) => {
    const labelItem = onPage.find((it) => it.x > heading.x && label(text(it)));
    if (!labelItem) return undefined;
    const figure = onPage
      .filter((it) => Math.abs(it.x - labelItem.x) <= SAME_LINE && it.y > labelItem.y && NUMBER.test(it.text.trim()))
      .sort((a, b) => a.y - b.y)[0];
    return figure ? toNumber(figure.text.trim()) : undefined;
  };
  out.members = countFor((s) => s === "จำนวนสมาชิก");
  out.inDebt = countFor((s) => s.startsWith("จำนวนสมาชิกที") && s.includes("เป็นหนี้") && !s.includes("ไม่"));
  return out;
}
