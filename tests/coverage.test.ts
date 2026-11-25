import { describe, expect, it } from "vitest";
import {
  DEFAULT_RATES,
  computeCollateral,
  filterCoverage,
  sortCoverage,
  summarize,
  withCollateral,
  type CoverageInput,
} from "../lib/coverage";
import { CoverageSheetError, parseCoverageSheet } from "../lib/coverageSheet";

// Real rows from สมาชิกทำประกันและฌาปนกิจ_2570.xlsx (รอบ 10/69), with the
// figures the workbook itself worked out, so the screen and the file agree.
const base: Omit<CoverageInput, "memberNumber"> = {
  memberName: null,
  unitName: null,
  gender: null,
  age: null,
  sharePeriods: null,
  shares: 0,
  debt: 0,
  insuredSum: 0,
  premium: 0,
  premiumDeducted: null,
  hasSok: false,
  hasScs: false,
  hasSst: false,
  hasSsk: false,
  relativeCount: 0,
  relativeFees: 0,
  debtStatus: null,
  undeducted: null,
};

const m22495: CoverageInput = {
  ...base,
  memberNumber: "22495",
  memberName: "นายระเบียบ คำอาจ",
  age: 71,
  sharePeriods: 276,
  shares: 439970,
  debt: 1786723.22,
  insuredSum: 3000000,
  premium: 28800,
  premiumDeducted: true,
  hasSok: true,
  hasScs: true,
  relativeCount: 2,
  relativeFees: 12540,
};

const m4855: CoverageInput = {
  ...base,
  memberNumber: "4855",
  memberName: "นางพูลศรี คล่องดี",
  age: 80,
  sharePeriods: 571,
  shares: 513340,
  debt: 1998140.5,
  insuredSum: 250000,
  premium: 2400,
  premiumDeducted: true,
  hasSok: true,
};

const m31107: CoverageInput = {
  ...base,
  memberNumber: "31107",
  memberName: "นายบรรพต บัวคำภู",
  age: 29,
  sharePeriods: 26,
  shares: 70300,
  debt: 295797.5,
  insuredSum: 500000,
  premium: 4800,
  premiumDeducted: false,
};

describe("computeCollateral", () => {
  it("adds shares, insurance, own cremation and capped welfare", () => {
    const c = computeCollateral(m22495);
    expect(c.cremation).toBe(1200000);
    expect(c.welfare).toBe(600000);
    expect(c.welfareCapped).toBe(true);
    expect(c.total).toBe(5239970);
    expect(c.margin).toBe(3453246.78);
    expect(c.associations).toBe(2);
  });

  it("does not count relatives' memberships", () => {
    expect(computeCollateral({ ...m22495, relativeCount: 9, relativeFees: 99999 }).cremation).toBe(1200000);
  });

  it("finds a shortfall", () => {
    const c = computeCollateral(m4855);
    expect(c.total).toBe(1963340);
    expect(c.margin).toBe(-34800.5);
  });

  it("pays welfare per instalment below the cap", () => {
    const c = computeCollateral(m31107);
    expect(c.welfare).toBe(65000);
    expect(c.welfareCapped).toBe(false);
    expect(c.margin).toBe(339502.5);
  });

  it("uses the round's own rates", () => {
    const c = computeCollateral(m22495, { ...DEFAULT_RATES, benefitSok: 500000, welfareCap: 300000 });
    expect(c.cremation).toBe(1100000);
    expect(c.welfare).toBe(300000);
  });

  it("treats a member missing from the share report as owing nothing known", () => {
    expect(computeCollateral({ ...m31107, debt: null }).debt).toBe(0);
  });
});

describe("filter, sort and summary", () => {
  const rows = [m22495, m4855, m31107].map((m) => withCollateral(m, DEFAULT_RATES));

  it("sorts the worst shortfall first", () => {
    expect(sortCoverage(rows).map((r) => r.memberNumber)).toEqual(["4855", "31107", "22495"]);
  });

  it("sorts by insured sum, largest first", () => {
    const sorted = sortCoverage(rows, "insured");
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1].insuredSum).toBeGreaterThanOrEqual(sorted[i].insuredSum);
    }
  });

  it("filters by status, premium, age and search", () => {
    expect(filterCoverage(rows, { status: "short" }).map((r) => r.memberNumber)).toEqual(["4855"]);
    expect(filterCoverage(rows, { premium: "fail" }).map((r) => r.memberNumber)).toEqual(["31107"]);
    expect(filterCoverage(rows, { ageFrom: 76, ageTo: 80 }).map((r) => r.memberNumber)).toEqual(["4855"]);
    expect(filterCoverage(rows, { search: "ระเบียบ" }).map((r) => r.memberNumber)).toEqual(["22495"]);
    expect(filterCoverage(rows, { associations: 0 }).map((r) => r.memberNumber)).toEqual(["31107"]);
  });

  it("summarises by age band", () => {
    const s = summarize(rows);
    expect(s.all.count).toBe(3);
    expect(s.short.count).toBe(1);
    expect(s.short.margin).toBe(-34800.5);
    expect(s.premiumFailed).toBe(1);
    expect(s.bands.find((b) => b.label === "76–80")?.shortCount).toBe(1);
    expect(s.bands.find((b) => b.label === "20–30")?.count).toBe(1);
  });
});

describe("parseCoverageSheet", () => {
  const header = [
    "เลขสมาชิก", "ชื่อ-สกุล", "หน่วยงาน", "เพศ", "อายุ", "อายุสมาชิก (งวด)", "หุ้น", "หนี้รวม",
    "ทุนประกัน", "เบี้ยประกัน", "สสอค.", "สส.ชสอ.", "สส.สท.", "สส.สก.", "ประกัน (หักจากปันผล)",
    "ญาติ (ราย)", "ค่าบำรุงญาติรวม", "สถานะหนี้", "รายการที่หักไม่ได้",
  ];

  it("skips the summary sheets and reads the list by heading", () => {
    const summarySheet = [["รายการ", "จำนวน (คน)"], ["สมาชิกทำประกันชีวิต", 3358]];
    const list = [
      header,
      [22495, "นายระเบียบ คำอาจ", "บำนาญ บึงกาฬ อ.บุ่งคล้า", "ชาย", 71, 276, 439970, 1786723.22, 3000000, 28800, 6650, 5890, null, null, "หักได้", 2, 12540, null, "สสอค สสชสอ ญาติ 2 ราย"],
      ["031107", "นายบรรพต บัวคำภู", "ร.ร.ดงเว้นดงเจริญวิทยา", "ชาย", 29, 26, 70300, 295797.5, 500000, 4800, null, null, null, null, "หักไม่ได้", null, null, null, "ประกัน"],
      [30010, "นางยุพิน จันดา", "x", "หญิง", 55, null, null, null, 3000000, 28800, null, null, null, null, "หักได้", null, null, null, null],
      ["รวม", null, null, null, null, null, null, null, 3500000],
    ];
    const sheet = parseCoverageSheet([summarySheet, list]);
    expect(sheet.sheetIndex).toBe(1);
    expect(sheet.rows).toHaveLength(3);
    const [a, b, c] = sheet.rows;
    expect(a).toMatchObject({ memberNumber: "22495", hasSok: true, hasScs: true, hasSst: false, premiumDeducted: true, sharePeriods: 276 });
    expect(computeCollateral(a).margin).toBe(3453246.78);
    expect(b).toMatchObject({ memberNumber: "31107", premiumDeducted: false, hasSok: false });
    expect(c).toMatchObject({ memberNumber: "30010", debt: null, debtStatus: "ไม่มีในรายงานหุ้นหนี้" });
  });

  it("refuses a file with no list", () => {
    expect(() => parseCoverageSheet([[["a", "b"], [1, 2]]])).toThrow(CoverageSheetError);
  });

  it("reports a repeated member and keeps the first", () => {
    const sheet = parseCoverageSheet([[header, [1, "ก"], [1, "ข"]].map((r, i) => (i === 0 ? r : [...r, ...Array(6).fill(null), 500000]))]);
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.problems[0].reason).toContain("ซ้ำ");
  });
});

describe("members without a life policy", () => {
  const rows = [m22495, m4855, m31107].map((m) => withCollateral(m, DEFAULT_RATES));
  const cremationOnly = withCollateral({ ...m31107, memberNumber: "99999", insuredSum: 0, premium: 0 }, DEFAULT_RATES);
  const mixed = [...rows, cremationOnly];

  it("are left out of the policy summary and counted apart", () => {
    const s = summarize(mixed);
    expect(s.all.count).toBe(rows.length);
    expect(s.uninsured.count).toBe(1);
  });

  it("are filtered in or out of the list", () => {
    expect(filterCoverage(mixed, { insured: "yes" }).map((r) => r.memberNumber)).not.toContain("99999");
    expect(filterCoverage(mixed, { insured: "no" }).map((r) => r.memberNumber)).toEqual(["99999"]);
    expect(filterCoverage(mixed, { insured: "" })).toHaveLength(4);
  });

  it("are hidden unless asked for", async () => {
    const { parseFilters } = await import("../lib/coverage");
    expect(parseFilters(new URLSearchParams("")).insured).toBe("yes");
    expect(parseFilters(new URLSearchParams("insured=all")).insured).toBe("");
    expect(parseFilters(new URLSearchParams("insured=no")).insured).toBe("no");
  });
});
