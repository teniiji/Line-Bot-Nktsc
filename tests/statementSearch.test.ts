import { describe, expect, it } from "vitest";
import {
  filterStatementRows,
  matchesStatementSearch,
  type SearchableStatementRow,
} from "../lib/statementSearch";

// Modelled on real rows from a 159-line day.
const row = (over: Partial<SearchableStatementRow> = {}): SearchableStatementRow => ({
  postedAt: "2026-09-09T10:29:51.000Z",
  txnCode: "NBSDT",
  description: "TR fr 4131579286",
  amount: 30000,
  balance: 36225597.6,
  account: "413",
  branch: "หนองคาย",
  senderAccount: null,
  memberNumber: "13140",
  memberName: "นางสาวพิมพ์สิริ ภมรศิริ",
  unitName: "บำนาญ อ.เมือง นค.",
  status: "knownPayer",
  ...over,
});

describe("matchesStatementSearch", () => {
  it("finds a row by anything the table shows", () => {
    // The point of searching the whole row: a person does not first decide
    // which column their fragment belongs to.
    for (const query of [
      "พิมพ์สิริ", // name
      "13140", // member number
      "บำนาญ", // unit
      "4131579286", // the bank's own description
      "NBSDT", // transaction code
      "หนองคาย", // branch
      "10:29", // time
      "รู้เจ้าของ", // status label
    ]) {
      expect(matchesStatementSearch(row(), query), query).toBe(true);
    }
  });

  it("finds the amount typed either way", () => {
    // "30000" is what a person types; "30,000" is what they copy off the
    // screen. Both have to land or the box looks broken.
    expect(matchesStatementSearch(row(), "30000")).toBe(true);
    expect(matchesStatementSearch(row(), "30,000")).toBe(true);
  });

  it("finds the seconds, which is why they are shown", () => {
    expect(matchesStatementSearch(row(), "10:29:51")).toBe(true);
  });

  it("ignores case", () => {
    expect(matchesStatementSearch(row(), "nbsdt")).toBe(true);
    expect(matchesStatementSearch(row({ txnCode: "nbsdt" }), "NBSDT")).toBe(true);
  });

  it("narrows on a second word instead of widening", () => {
    // Every term must match. "30000 บึงกาฬ" is a row that is both, and this
    // row is only the first.
    expect(matchesStatementSearch(row(), "30000 หนองคาย")).toBe(true);
    expect(matchesStatementSearch(row(), "30000 บึงกาฬ")).toBe(false);
  });

  it("matches everything on an empty or blank query", () => {
    // The unfiltered table is the default view, so a cleared box must not
    // read as "nothing matched".
    expect(matchesStatementSearch(row(), "")).toBe(true);
    expect(matchesStatementSearch(row(), "    ")).toBe(true);
  });

  it("does not fall over on a row that knows nothing about its payer", () => {
    // Every one of these is null on a bank fee line, and the haystack still
    // has to be a string.
    const bare = row({
      postedAt: null,
      senderAccount: null,
      memberNumber: null,
      memberName: null,
      unitName: null,
      balance: null,
      status: "notMemberMoney",
    });
    expect(matchesStatementSearch(bare, "NBSDT")).toBe(true);
    expect(matchesStatementSearch(bare, "พิมพ์สิริ")).toBe(false);
    expect(matchesStatementSearch(bare, "")).toBe(true);
  });
});

describe("filterStatementRows", () => {
  const rows = [
    row({ memberName: "นางสาวพิมพ์สิริ ภมรศิริ", memberNumber: "13140", amount: 30000 }),
    row({ memberName: "นางกรณ์ทิพย์ เข็มศิริ", memberNumber: "29262", amount: 4200 }),
    row({ memberName: null, memberNumber: null, amount: 8, status: "notMemberMoney" }),
  ];

  it("keeps only the matching rows, in the order the bank wrote them", () => {
    const found = filterStatementRows(rows, "ศิริ");
    expect(found).toHaveLength(2);
    expect(found[0].memberNumber).toBe("13140");
    expect(found[1].memberNumber).toBe("29262");
  });

  it("returns every row when nothing is typed", () => {
    expect(filterStatementRows(rows, "")).toHaveLength(3);
    expect(filterStatementRows(rows, "  ")).toHaveLength(3);
  });

  it("returns nothing rather than everything when nothing matches", () => {
    // The failure that would make the box dangerous: a query nobody matches
    // silently showing the unfiltered file.
    expect(filterStatementRows(rows, "ไม่มีใครชื่อนี้")).toHaveLength(0);
  });

  it("does not mutate or reorder the list it was given", () => {
    const before = [...rows];
    filterStatementRows(rows, "ศิริ");
    expect(rows).toEqual(before);
  });
});
