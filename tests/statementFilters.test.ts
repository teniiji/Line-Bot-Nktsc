import { describe, expect, it } from "vitest";
import {
  filterStatementMembers,
  sortStatementMembers,
  summarizeStatementMembers,
  outstandingOf,
  unitNamesOf,
  hCodesOf,
} from "../lib/statementFilters";
import { StatementMemberRow } from "../lib/types";

const member = (over: Partial<StatementMemberRow>): StatementMemberRow => ({
  id: Math.random().toString(36),
  memberNumber: "001234",
  name: "สมชาย ใจดี",
  unitName: "โรงเรียนบ้านโนนสวรรค์",
  hCode: "1",
  note: null,
  accountNumber: "4131234567",
  amountDue: 1000,
  amountPaid: 0,
  paidAt: null,
  paidBranch: null,
  status: "unpaid",
  ...over,
});

const rows: StatementMemberRow[] = [
  member({ memberNumber: "001", name: "สมชาย ใจดี", amountDue: 1000, amountPaid: 1000, status: "paid" }),
  member({
    memberNumber: "002",
    name: "สมหญิง รักดี",
    unitName: "โรงเรียนบ้านหนองบัว",
    amountDue: 5000,
    amountPaid: 2000,
    status: "unpaid",
  }),
  member({
    memberNumber: "003",
    name: "วิชัย มั่นคง",
    unitName: "โรงเรียนบ้านหนองบัว",
    accountNumber: null,
    amountDue: 300,
    amountPaid: 0,
    status: "unpaid",
  }),
  member({
    memberNumber: "004",
    name: "อรุณ แสงทอง",
    hCode: "10",
    amountDue: 500,
    amountPaid: 700,
    status: "overpaid",
  }),
];

describe("filterStatementMembers", () => {
  const base = { search: "", unitName: "", hCode: "", status: "all" };

  it("returns everything with no filters applied", () => {
    expect(filterStatementMembers(rows, base)).toHaveLength(4);
  });

  it("filters by reconciliation status", () => {
    expect(filterStatementMembers(rows, { ...base, status: "paid" })).toHaveLength(1);
    expect(filterStatementMembers(rows, { ...base, status: "unpaid" })).toHaveLength(2);
    expect(filterStatementMembers(rows, { ...base, status: "overpaid" })).toHaveLength(1);
  });

  it("singles out members with no account number to match against", () => {
    const found = filterStatementMembers(rows, { ...base, status: "no_account" });
    expect(found.map((m) => m.memberNumber)).toEqual(["003"]);
  });

  it("filters by unit", () => {
    const found = filterStatementMembers(rows, { ...base, unitName: "โรงเรียนบ้านหนองบัว" });
    expect(found.map((m) => m.memberNumber)).toEqual(["002", "003"]);
  });

  it("searches name, member number, account number and unit", () => {
    expect(filterStatementMembers(rows, { ...base, search: "สมหญิง" })).toHaveLength(1);
    expect(filterStatementMembers(rows, { ...base, search: "004" })).toHaveLength(1);
    expect(filterStatementMembers(rows, { ...base, search: "หนองบัว" })).toHaveLength(2);
  });

  it("matches an account number typed with dashes against the stored digits", () => {
    const found = filterStatementMembers(rows, { ...base, search: "413-123-4567" });
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((m) => m.accountNumber === "4131234567")).toBe(true);
  });

  it("filters by หน่วยคุม (H-code)", () => {
    expect(
      filterStatementMembers(rows, { ...base, hCode: "1" }).map((m) => m.memberNumber)
    ).toEqual(["001", "002", "003"]);
    expect(
      filterStatementMembers(rows, { ...base, hCode: "10" }).map((m) => m.memberNumber)
    ).toEqual(["004"]);
  });

  it("does not confuse หน่วยคุม 1 with หน่วยคุม 10", () => {
    // A prefix match here would quietly fold หน่วยคุม 10 into 1.
    const found = filterStatementMembers(rows, { ...base, hCode: "1" });
    expect(found.some((m) => m.hCode === "10")).toBe(false);
  });

  it("combines filters rather than replacing them", () => {
    const found = filterStatementMembers(rows, {
      search: "สมหญิง",
      unitName: "โรงเรียนบ้านหนองบัว",
      hCode: "1",
      status: "unpaid",
    });
    expect(found.map((m) => m.memberNumber)).toEqual(["002"]);
  });

  it("returns nobody when หน่วยคุม and สังกัด disagree", () => {
    const found = filterStatementMembers(rows, {
      ...base,
      hCode: "10",
      unitName: "โรงเรียนบ้านหนองบัว",
    });
    expect(found).toHaveLength(0);
  });
});

describe("outstandingOf", () => {
  it("is what is still owed, and never negative for someone who overpaid", () => {
    expect(outstandingOf(rows[1])).toBe(3000);
    expect(outstandingOf(rows[3])).toBe(0);
  });
});

describe("sortStatementMembers", () => {
  it("leaves the API's own ordering alone by default", () => {
    expect(sortStatementMembers(rows, "default")).toBe(rows);
  });

  it("puts the largest outstanding balance first", () => {
    const sorted = sortStatementMembers(rows, "outstanding");
    expect(sorted.map((m) => m.memberNumber)).toEqual(["002", "003", "001", "004"]);
  });

  it("sorts by member number without mutating the input", () => {
    const sorted = sortStatementMembers(rows, "memberNumber");
    expect(sorted.map((m) => m.memberNumber)).toEqual(["001", "002", "003", "004"]);
    expect(rows[0].memberNumber).toBe("001");
  });

  it("sorts by หน่วยคุม as a number, then สังกัด, then member number", () => {
    const mixed = [
      member({ memberNumber: "b", hCode: "10", unitName: "ก" }),
      member({ memberNumber: "a", hCode: "10", unitName: "ก" }),
      member({ memberNumber: "c", hCode: "2", unitName: "ข" }),
      member({ memberNumber: "d", hCode: "10", unitName: "ก ก" }),
    ];
    // หน่วยคุม 2 before 10 (numeric, not "10" < "2"), then สังกัด, then member.
    expect(sortStatementMembers(mixed, "hCode").map((m) => m.memberNumber)).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
  });

  it("puts members with no หน่วยคุม last rather than treating them as zero", () => {
    const mixed = [
      member({ memberNumber: "none", hCode: null }),
      member({ memberNumber: "has", hCode: "9" }),
    ];
    expect(sortStatementMembers(mixed, "hCode").map((m) => m.memberNumber)).toEqual([
      "has",
      "none",
    ]);
  });

  it("sorts by สังกัด in Thai order, blank ones last", () => {
    const mixed = [
      member({ memberNumber: "x", unitName: null }),
      member({ memberNumber: "y", unitName: "โรงเรียนบ้านหนองบัว" }),
      member({ memberNumber: "z", unitName: "โรงเรียนบ้านโนนสวรรค์" }),
    ];
    expect(sortStatementMembers(mixed, "unitName").map((m) => m.memberNumber)).toEqual([
      "z",
      "y",
      "x",
    ]);
  });

  it("sorts by วันที่โอน newest first, with people who never paid last", () => {
    const mixed = [
      member({ memberNumber: "old", paidAt: "2026-06-05T00:00:00.000Z" }),
      member({ memberNumber: "never", paidAt: null }),
      member({ memberNumber: "new", paidAt: "2026-06-28T00:00:00.000Z" }),
      member({ memberNumber: "mid", paidAt: "2026-06-14T00:00:00.000Z" }),
    ];
    expect(sortStatementMembers(mixed, "paidAt").map((m) => m.memberNumber)).toEqual([
      "new",
      "mid",
      "old",
      "never",
    ]);
  });
});

describe("summarizeStatementMembers", () => {
  it("totals only the rows it is given", () => {
    const unpaidOnly = filterStatementMembers(rows, {
      search: "",
      unitName: "",
      hCode: "",
      status: "unpaid",
    });
    expect(summarizeStatementMembers(unpaidOnly)).toEqual({
      count: 2,
      due: 5300,
      paid: 2000,
      outstanding: 3300,
    });
  });
});

describe("unitNamesOf", () => {
  // Thai collation, not codepoint order: a leading vowel sorts by the
  // consonant after it, so โนนสวรรค์ (น) comes before หนองบัว (ห) even though
  // โ sits after ห in Unicode.
  it("lists each unit once in Thai alphabetical order, ignoring members with none", () => {
    expect(unitNamesOf([...rows, member({ unitName: null })])).toEqual([
      "โรงเรียนบ้านโนนสวรรค์",
      "โรงเรียนบ้านหนองบัว",
    ]);
  });
});

describe("hCodesOf", () => {
  it("lists each หน่วยคุม once, ignoring members with none", () => {
    expect(hCodesOf([...rows, member({ hCode: null })])).toEqual(["1", "10"]);
  });

  it("orders them as numbers, not as text", () => {
    const codes = hCodesOf([
      member({ hCode: "10" }),
      member({ hCode: "2" }),
      member({ hCode: "1" }),
      member({ hCode: "25" }),
      member({ hCode: "9" }),
    ]);
    expect(codes).toEqual(["1", "2", "9", "10", "25"]);
  });
});
