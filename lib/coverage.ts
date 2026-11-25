// ประกันและหลักประกัน — what stands behind a member's debt.
//
// The cooperative's question is "if this member died tomorrow, would what is
// paid out cover what they owe?". What is paid out comes from five places:
//
//   หุ้น                the member's own share capital
//   ทุนประกันชีวิต      the group life policy (ทิพยประกันชีวิต)
//   ฌาปนกิจ            each cremation association the member belongs to
//                       themselves — a relative's membership pays the
//                       relative's family, not this debt, so it never counts
//   สวัสดิการสหกรณ์      งวดหุ้น × 2,500, capped at 600,000
//
// The amounts per association and the welfare rate belong to the import round
// (CoverageSnapshot), not to this file, so a change of rate is a setting and
// an older round keeps adding up the way it did.

export interface CoverageRates {
  benefitSok: number;
  benefitScs: number;
  benefitSst: number;
  benefitSsk: number;
  welfarePerPeriod: number;
  welfareCap: number;
}

export const DEFAULT_RATES: CoverageRates = {
  benefitSok: 600000,
  benefitScs: 600000,
  benefitSst: 450000,
  benefitSsk: 350000,
  welfarePerPeriod: 2500,
  welfareCap: 600000,
};

export interface CoverageInput {
  memberNumber: string;
  memberName: string | null;
  unitName: string | null;
  gender: string | null;
  age: number | null;
  sharePeriods: number | null;
  shares: number;
  debt: number | null;
  insuredSum: number;
  premium: number;
  premiumDeducted: boolean | null;
  hasSok: boolean;
  hasScs: boolean;
  hasSst: boolean;
  hasSsk: boolean;
  relativeCount: number;
  relativeFees: number;
  debtStatus: string | null;
  undeducted: string | null;
}

export interface Collateral {
  shares: number;
  insuredSum: number;
  cremation: number;
  welfare: number;
  welfareCapped: boolean;
  total: number;
  debt: number;
  // total − debt. Negative is a shortfall.
  margin: number;
  associations: number;
}

export type CoverageRow = CoverageInput & Collateral;

const round2 = (x: number) => Math.round(x * 100) / 100;

export function computeCollateral(m: CoverageInput, rates: CoverageRates = DEFAULT_RATES): Collateral {
  const cremation =
    (m.hasSok ? rates.benefitSok : 0) +
    (m.hasScs ? rates.benefitScs : 0) +
    (m.hasSst ? rates.benefitSst : 0) +
    (m.hasSsk ? rates.benefitSsk : 0);
  const rawWelfare = Math.max(0, m.sharePeriods ?? 0) * rates.welfarePerPeriod;
  const welfare = Math.min(rawWelfare, rates.welfareCap);
  const shares = m.shares || 0;
  const total = round2(shares + m.insuredSum + cremation + welfare);
  const debt = m.debt ?? 0;
  return {
    shares,
    insuredSum: m.insuredSum,
    cremation,
    welfare,
    welfareCapped: rawWelfare > rates.welfareCap,
    total,
    debt,
    margin: round2(total - debt),
    associations: [m.hasSok, m.hasScs, m.hasSst, m.hasSsk].filter(Boolean).length,
  };
}

export function withCollateral(m: CoverageInput, rates: CoverageRates): CoverageRow {
  return { ...m, ...computeCollateral(m, rates) };
}

// The age bands the cooperative and the insurer both count by: the insurer's
// limits fall at 70 (new members), 75 (new members, capped sum) and 80
// (continuing cover), so those are band edges.
export const AGE_BANDS: { label: string; from: number; to: number }[] = [
  { label: "20–30", from: 0, to: 30 },
  { label: "31–40", from: 31, to: 40 },
  { label: "41–50", from: 41, to: 50 },
  { label: "51–60", from: 51, to: 60 },
  { label: "61–70", from: 61, to: 70 },
  { label: "71–75", from: 71, to: 75 },
  { label: "76–80", from: 76, to: 80 },
  { label: "81 ขึ้นไป", from: 81, to: 200 },
];

export interface CoverageFilters {
  search?: string;
  ageFrom?: number | null;
  ageTo?: number | null;
  units?: string[];
  status?: "short" | "ok" | "";
  premium?: "ok" | "fail" | "";
  associations?: number | null;
}

export function filterCoverage(rows: CoverageRow[], f: CoverageFilters): CoverageRow[] {
  const q = f.search?.trim().toLowerCase().replace(/\s+/g, "") ?? "";
  const units = f.units?.length ? new Set(f.units) : null;
  return rows.filter((r) => {
    if (q) {
      const name = (r.memberName ?? "").toLowerCase().replace(/\s+/g, "");
      if (!r.memberNumber.includes(q) && !name.includes(q)) return false;
    }
    if (f.ageFrom != null && (r.age == null || r.age < f.ageFrom)) return false;
    if (f.ageTo != null && (r.age == null || r.age > f.ageTo)) return false;
    if (units && !units.has(r.unitName ?? "")) return false;
    if (f.status === "short" && !(r.margin < 0)) return false;
    if (f.status === "ok" && r.margin < 0) return false;
    if (f.premium === "ok" && r.premiumDeducted !== true) return false;
    if (f.premium === "fail" && r.premiumDeducted !== false) return false;
    if (f.associations != null && r.associations !== f.associations) return false;
    return true;
  });
}

export type CoverageSort = "margin" | "debt" | "insured" | "age" | "member";

export function sortCoverage(rows: CoverageRow[], sort: CoverageSort = "margin"): CoverageRow[] {
  const out = [...rows];
  const byMember = (a: CoverageRow, b: CoverageRow) =>
    a.memberNumber.localeCompare(b.memberNumber, undefined, { numeric: true });
  switch (sort) {
    case "debt":
      return out.sort((a, b) => b.debt - a.debt || byMember(a, b));
    case "insured":
      return out.sort((a, b) => b.insuredSum - a.insuredSum || byMember(a, b));
    case "age":
      return out.sort((a, b) => (b.age ?? -1) - (a.age ?? -1) || byMember(a, b));
    case "member":
      return out.sort(byMember);
    default:
      // Worst shortfall first: the list is for finding who to look at.
      return out.sort((a, b) => a.margin - b.margin || byMember(a, b));
  }
}

export interface CoverageTotals {
  count: number;
  shares: number;
  debt: number;
  insuredSum: number;
  cremation: number;
  welfare: number;
  total: number;
  margin: number;
}

export function totals(rows: CoverageRow[]): CoverageTotals {
  const t: CoverageTotals = { count: 0, shares: 0, debt: 0, insuredSum: 0, cremation: 0, welfare: 0, total: 0, margin: 0 };
  for (const r of rows) {
    t.count += 1;
    t.shares += r.shares;
    t.debt += r.debt;
    t.insuredSum += r.insuredSum;
    t.cremation += r.cremation;
    t.welfare += r.welfare;
    t.total += r.total;
    t.margin += r.margin;
  }
  for (const k of ["shares", "debt", "insuredSum", "total", "margin"] as const) t[k] = round2(t[k]);
  return t;
}

export interface CoverageSummary {
  all: CoverageTotals;
  withDebt: CoverageTotals;
  noDebt: CoverageTotals;
  enough: CoverageTotals;
  short: CoverageTotals;
  premiumFailed: number;
  notInShareReport: number;
  bands: (CoverageTotals & { label: string; from: number; to: number; shortCount: number; shortMargin: number })[];
}

export function summarize(rows: CoverageRow[]): CoverageSummary {
  const short = rows.filter((r) => r.margin < 0);
  return {
    all: totals(rows),
    withDebt: totals(rows.filter((r) => r.debt > 0)),
    noDebt: totals(rows.filter((r) => r.debt <= 0)),
    enough: totals(rows.filter((r) => r.margin >= 0)),
    short: totals(short),
    premiumFailed: rows.filter((r) => r.premiumDeducted === false).length,
    notInShareReport: rows.filter((r) => r.debtStatus === "ไม่มีในรายงานหุ้นหนี้").length,
    bands: AGE_BANDS.map((b) => {
      const inBand = rows.filter((r) => r.age != null && r.age >= b.from && r.age <= b.to);
      const s = inBand.filter((r) => r.margin < 0);
      return {
        ...b,
        ...totals(inBand),
        shortCount: s.length,
        shortMargin: round2(s.reduce((acc, r) => acc + r.margin, 0)),
      };
    }),
  };
}

export function parseFilters(params: URLSearchParams): CoverageFilters {
  const int = (k: string) => {
    const v = params.get(k);
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const status = params.get("status");
  const premium = params.get("premium");
  return {
    search: params.get("search") ?? "",
    ageFrom: int("ageFrom"),
    ageTo: int("ageTo"),
    units: params.getAll("unit").filter(Boolean),
    status: status === "short" || status === "ok" ? status : "",
    premium: premium === "ok" || premium === "fail" ? premium : "",
    associations: int("assoc"),
  };
}
