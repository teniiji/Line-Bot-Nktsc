import { describe, expect, it } from "vitest";
import {
  filterStatementMembers,
  sortStatementMembers,
  summarizeStatementMembers,
  outstandingOf,
  unitNamesOf,
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
  member({ memberNumber: "004", name: "อรุณ แสงทอง", amountDue: 500, amountPaid: 700, status: "overpaid" }),
];

describe("filterStatementMembers", () => {
  const base = { search: "", unitName: "", status: "all" };

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

  it("combines filters rather than replacing them", () => {
    const found = filterStatementMembers(rows, {
      search: "สมหญิง",
      unitName: "โรงเรียนบ้านหนองบัว",
      status: "unpaid",
    });
    expect(found.map((m) => m.memberNumber)).toEqual(["002"]);
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
});

describe("summarizeStatementMembers", () => {
  it("totals only the rows it is given", () => {
    const unpaidOnly = filterStatementMembers(rows, {
      search: "",
      unitName: "",
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
