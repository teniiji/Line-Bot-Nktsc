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

// The other four sections of the tab. One box searches all of them, so each
// shape needs its own haystack — a person looking for member 26018 does not
// know which conclusion their payment landed under, which is usually the
// whole reason they are looking.
import {
  depositHaystack,
  filterBy,
  matchedPairHaystack,
  matchesTerms,
  otherLineHaystack,
  slipHaystack,
} from "../lib/statementSearch";
import type { DailyDepositRow, DailyOtherLineRow, DailySlipRow } from "../lib/types";

const deposit = (over: Partial<DailyDepositRow> = {}): DailyDepositRow => ({
  id: "d1",
  amount: 173000,
  postedAt: "2026-09-08T07:01:59.000Z",
  senderAccount: "4131355035",
  channel: "transfer",
  branch: "หนองคาย",
  description: "TR fr 4131355035",
  memberNumber: null,
  ...over,
});

const slip = (over: Partial<DailySlipRow> = {}): DailySlipRow => ({
  id: "s1",
  amount: 1800000,
  date: "2026-09-04T00:00:00.000Z",
  memberNumber: "26018",
  memberFullName: "นางการดี ดวงสีมา",
  category: "ฝากเงิน",
  transferTime: null,
  senderAccount: null,
  slipImageUrl: null,
  statementLineId: "x1",
  ...over,
});

const otherLine = (over: Partial<DailyOtherLineRow> = {}): DailyOtherLineRow => ({
  id: "o1",
  amount: -8,
  postedAt: "2026-09-09T08:04:23.000Z",
  txnCode: "BPSFE",
  description: "BP Fee-1000012738769",
  branch: "หนองคาย",
  ...over,
});

describe("the other sections' haystacks", () => {
  it("finds a deposit by its paying account, amount, channel or date", () => {
    const hay = depositHaystack(deposit());
    for (const term of ["4131355035", "173000", "หนองคาย", "2569"]) {
      expect(matchesTerms(hay, term), term).toBe(true);
    }
  });

  it("finds a slip by the member's name or number", () => {
    const hay = slipHaystack(slip());
    expect(matchesTerms(hay, "26018")).toBe(true);
    expect(matchesTerms(hay, "การดี")).toBe(true);
    expect(matchesTerms(hay, "ฝากเงิน")).toBe(true);
    expect(matchesTerms(hay, "1,800,000")).toBe(true);
  });

  it("finds an other-line by its bank code", () => {
    const hay = otherLineHaystack(otherLine());
    expect(matchesTerms(hay, "BPSFE".toLowerCase())).toBe(true);
    expect(matchesTerms(hay, "1000012738769")).toBe(true);
  });

  it("searches both halves of a matched pair", () => {
    // The member name only exists on the slip and the bank's description only
    // on the deposit; somebody searching does not know or care which is which.
    const hay = matchedPairHaystack({ deposit: deposit(), slip: slip() });
    expect(matchesTerms(hay, "การดี")).toBe(true);
    expect(matchesTerms(hay, "4131355035")).toBe(true);
  });

  it("keeps the same all-terms-must-match rule as the statement table", () => {
    // A box that behaves differently depending on which table it is over is
    // worse than none.
    const hay = depositHaystack(deposit());
    expect(matchesTerms(hay, "173000 หนองคาย")).toBe(true);
    expect(matchesTerms(hay, "173000 บึงกาฬ")).toBe(false);
    expect(matchesTerms(hay, "")).toBe(true);
  });

  it("survives rows where every optional field is missing", () => {
    const bare = deposit({
      postedAt: null,
      senderAccount: null,
      memberNumber: null,
      description: "",
    });
    expect(matchesTerms(depositHaystack(bare), "")).toBe(true);
    expect(matchesTerms(depositHaystack(bare), "4131355035")).toBe(false);

    // Clearing senderAccount alone does not hide the number: the bank prints
    // it in the description too, and that is the column staff read.
    const noAccountField = deposit({ senderAccount: null });
    expect(matchesTerms(depositHaystack(noAccountField), "4131355035")).toBe(true);
    const bareSlip = slip({ memberNumber: null, memberFullName: null, category: null });
    expect(matchesTerms(slipHaystack(bareSlip), "การดี")).toBe(false);
  });
});

describe("filterBy", () => {
  const rows = [deposit(), deposit({ id: "d2", senderAccount: "4131152517", amount: 8000 })];

  it("narrows to the matching rows and keeps their order", () => {
    const found = filterBy(rows, "4131152517", depositHaystack);
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe("d2");
  });

  it("returns everything on a blank query and nothing on a miss", () => {
    expect(filterBy(rows, "   ", depositHaystack)).toHaveLength(2);
    expect(filterBy(rows, "ไม่มีอะไรตรง", depositHaystack)).toHaveLength(0);
  });
});
