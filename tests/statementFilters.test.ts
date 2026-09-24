import { describe, expect, it } from "vitest";
import {
  filterStatementMembers,
  sortStatementMembers,
  summarizeStatementMembers,
  outstandingOf,
  matchesStatus,
  hCodesOf,
  subUnitsOf,
  encodeSubUnit,
  parseSubUnit,
} from "../lib/statementFilters";
import { StatementMemberRow } from "../lib/types";

const member = (over: Partial<StatementMemberRow>): StatementMemberRow => ({
  id: Math.random().toString(36),
  memberNumber: "001234",
  name: "สมชาย ใจดี",
  unitName: "โรงเรียนบ้านโนนสวรรค์",
  unitCode: null,
  hCode: "1",
  note: null,
  accountNumber: "4131234567",
  expectedAmount: null,
  deductionResult: "uncollected",
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
  const base = { search: "", hCodes: [] as string[], subUnits: [] as string[], status: "all" };

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
    const found = filterStatementMembers(rows, {
      ...base,
      subUnits: ["u:โรงเรียนบ้านหนองบัว"],
    });
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
      filterStatementMembers(rows, { ...base, hCodes: ["1"] }).map((m) => m.memberNumber)
    ).toEqual(["001", "002", "003"]);
    expect(
      filterStatementMembers(rows, { ...base, hCodes: ["10"] }).map((m) => m.memberNumber)
    ).toEqual(["004"]);
  });

  it("takes several หน่วยคุม at once", () => {
    // "These are mine this week" is one question, and the totals under the
    // table have to answer it for the three of them together.
    const found = filterStatementMembers(rows, { ...base, hCodes: ["1", "10"] });
    expect(found).toHaveLength(4);
  });

  it("takes several หน่วยคุมย่อย at once", () => {
    const found = filterStatementMembers(rows, {
      ...base,
      subUnits: ["u:โรงเรียนบ้านหนองบัว", "u:โรงเรียนบ้านโนนสวรรค์"],
    });
    expect(found).toHaveLength(4);
  });

  it("is no filter at all when nothing is ticked", () => {
    expect(filterStatementMembers(rows, { ...base, hCodes: [], subUnits: [] })).toHaveLength(4);
  });

  it("does not confuse หน่วยคุม 1 with หน่วยคุม 10", () => {
    // A prefix match here would quietly fold หน่วยคุม 10 into 1.
    const found = filterStatementMembers(rows, { ...base, hCodes: ["1"] });
    expect(found.some((m) => m.hCode === "10")).toBe(false);
  });

  it("combines filters rather than replacing them", () => {
    const found = filterStatementMembers(rows, {
      ...base,
      search: "สมหญิง",
      subUnits: ["u:โรงเรียนบ้านหนองบัว"],
      hCodes: ["1"],
      status: "unpaid",
    });
    expect(found.map((m) => m.memberNumber)).toEqual(["002"]);
  });

  it("returns nobody when หน่วยคุม and สังกัด disagree", () => {
    const found = filterStatementMembers(rows, {
      ...base,
      hCodes: ["10"],
      subUnits: ["u:โรงเรียนบ้านหนองบัว"],
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

  it("sorts by name with the honorific stripped, not by it", () => {
    // "นาง"/"นาย"/"นางสาว" all sort before every Thai given name — left in,
    // the whole table would group by title first and name second.
    const mixed = [
      member({ memberNumber: "a", name: "นายบุญมี ศรีสุข" }),
      member({ memberNumber: "b", name: "นางสาวอารีย์ ทองดี" }),
      member({ memberNumber: "c", name: "นางกัลยา วงศ์ใหญ่" }),
    ];
    // By given name once the title is gone: กัลยา, บุญมี, อารีย์.
    expect(sortStatementMembers(mixed, "name").map((m) => m.memberNumber)).toEqual([
      "c",
      "a",
      "b",
    ]);
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

  it("applies several orderings in the order they were chosen", () => {
    // "หน่วยคุม แล้วยอดค้างมากก่อน" — work through the units, biggest debt
    // first inside each. Neither ordering on its own can ask for that.
    const mixed = [
      member({ memberNumber: "small-1", hCode: "1", amountDue: 100, amountPaid: 0 }),
      member({ memberNumber: "big-2", hCode: "2", amountDue: 9000, amountPaid: 0 }),
      member({ memberNumber: "big-1", hCode: "1", amountDue: 5000, amountPaid: 0 }),
      member({ memberNumber: "small-2", hCode: "2", amountDue: 200, amountPaid: 0 }),
    ];
    expect(
      sortStatementMembers(mixed, ["hCode", "outstanding"]).map((m) => m.memberNumber)
    ).toEqual(["big-1", "small-1", "big-2", "small-2"]);
    // The same two the other way round is a different question, and gives a
    // different answer: the biggest debts in the cooperative, unit immaterial.
    expect(
      sortStatementMembers(mixed, ["outstanding", "hCode"]).map((m) => m.memberNumber)
    ).toEqual(["big-2", "big-1", "small-2", "small-1"]);
  });

  it("falls back to เลขสมาชิก when the chosen orderings cannot separate two rows", () => {
    const tied = [
      member({ memberNumber: "222", amountDue: 100, amountPaid: 0 }),
      member({ memberNumber: "111", amountDue: 100, amountPaid: 0 }),
    ];
    expect(sortStatementMembers(tied, ["outstanding"]).map((m) => m.memberNumber)).toEqual([
      "111",
      "222",
    ]);
  });

  it("leaves the API's order alone when every ordering has been taken away", () => {
    expect(sortStatementMembers(rows, [])).toBe(rows);
    expect(sortStatementMembers(rows, ["default"])).toBe(rows);
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
      hCodes: [],
      subUnits: [],
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

describe("the ไม่มีเลขบัญชี chip", () => {
  // A round seeded from the ไฟล์รวม, which carries no account numbers at
  // all: 6,267 members without one, none of them owing anything yet. The
  // chip counted all of them and then showed an empty table when clicked,
  // because the filter behind it asks only about people who owe.
  const seeded = [
    member({ memberNumber: "1", accountNumber: null, deductionResult: "awaiting" }),
    member({ memberNumber: "2", accountNumber: null, deductionResult: "awaiting" }),
    member({ memberNumber: "3", accountNumber: null, deductionResult: "uncollected" }),
  ];

  it("counts only the members its own filter would show", () => {
    const counted = seeded.filter((m) => matchesStatus(m, "no_account"));
    expect(counted.map((m) => m.memberNumber)).toEqual(["3"]);
    expect(counted).toEqual(
      filterStatementMembers(seeded, {
        search: "",
        hCodes: [],
        subUnits: [],
        status: "no_account",
      })
    );
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

describe("subUnitsOf", () => {
  const school = (code: string | null, name: string | null, hCode = "1") =>
    member({ unitCode: code, unitName: name, hCode });

  it("shows the รหัสสังกัด in front of the name, as the cooperative's lists do", () => {
    expect(subUnitsOf([school("13003", "ร.ร.อนุบาลอรุณรังษี")])[0]).toMatchObject({
      code: "13003",
      name: "ร.ร.อนุบาลอรุณรังษี",
      label: "13003 ร.ร.อนุบาลอรุณรังษี",
    });
  });

  it("narrows to the chosen หน่วยคุม, however many are ticked", () => {
    const all = [
      school("13003", "ร.ร.อนุบาลอรุณรังษี", "1"),
      school("23003", "ร.ร.บ้านน้ำสวย", "2"),
      school("33003", "ร.ร.อนุบาลจุมพล", "3"),
    ];
    expect(subUnitsOf(all, ["2"]).map((u) => u.code)).toEqual(["23003"]);
    expect(subUnitsOf(all, ["1", "3"]).map((u) => u.code)).toEqual(["13003", "33003"]);
    expect(subUnitsOf(all).map((u) => u.code)).toEqual(["13003", "23003", "33003"]);
  });

  it("keeps two สังกัด that share a name apart", () => {
    // 656 codes against 646 names in the ไฟล์รวม: picking one must not
    // quietly bring the other along.
    const shared = [school("13003", "ร.ร.บ้านโนนสว่าง"), school("43010", "ร.ร.บ้านโนนสว่าง")];
    const found = subUnitsOf(shared);
    expect(found).toHaveLength(2);
    expect(new Set(found.map((u) => u.value)).size).toBe(2);
  });

  it("is still pickable on a round imported before รหัสสังกัด was read", () => {
    const found = subUnitsOf([school(null, "บำนาญ บึงกาฬ")]);
    expect(found[0]).toMatchObject({ code: null, label: "บำนาญ บึงกาฬ", value: "u:บำนาญ บึงกาฬ" });
  });

  it("leaves out members with neither code nor name rather than offering a blank", () => {
    expect(subUnitsOf([school(null, null)])).toEqual([]);
  });

  it("round-trips a name containing the separator", () => {
    const name = "ร.ร.บ้านโนนสว่าง c:13003";
    expect(parseSubUnit(encodeSubUnit({ unitCode: null, unitName: name }))).toEqual({
      unitCode: "",
      unitName: name,
    });
  });

  it("filters by the code where there is one, not by the name", () => {
    expect(parseSubUnit("c:13003")).toEqual({ unitCode: "13003", unitName: "" });
    expect(parseSubUnit("")).toEqual({ unitCode: "", unitName: "" });
  });
});

describe("members the cooperative holds several accounts for", () => {
  // Reported from the round's table: member 27019 showing "ไม่มีเลขบัญชี"
  // while the directory held 2173433169 and 4321090407 for them. The fill
  // refuses to choose between a member's own accounts, so the column stays
  // blank — but blank meant two different things, and only one of them is
  // somebody staff have to find an account number for.
  const ambiguous = member({
    memberNumber: "27019",
    accountNumber: null,
    knownAccounts: ["2173433169", "4321090407"],
    deductionResult: "uncollected",
  });
  const unknown = member({
    memberNumber: "31679",
    accountNumber: null,
    knownAccounts: [],
    deductionResult: "uncollected",
  });

  it("keeps a member with accounts on file out of ⛔ ไม่มีเลขบัญชี", () => {
    const shown = filterStatementMembers([ambiguous, unknown], {
      search: "",
      hCodes: [],
      subUnits: [],
      status: "no_account",
    });
    expect(shown.map((m) => m.memberNumber)).toEqual(["31679"]);
  });

  it("gathers them under their own bucket instead", () => {
    const shown = filterStatementMembers([ambiguous, unknown], {
      search: "",
      hCodes: [],
      subUnits: [],
      status: "many_accounts",
    });
    expect(shown.map((m) => m.memberNumber)).toEqual(["27019"]);
  });

  it("leaves a member whose account is filled in out of both", () => {
    const filled = member({ accountNumber: "4131234567", knownAccounts: [] });
    const asked = (status: string) =>
      filterStatementMembers([filled], {
        search: "",
        hCodes: [],
        subUnits: [],
        status,
      });
    expect(asked("no_account")).toHaveLength(0);
    expect(asked("many_accounts")).toHaveLength(0);
  });
});

describe("ordering by รหัสสังกัด", () => {
  // The codes are five and six digits mixed, so text ordering puts 103003
  // between 100 and 13003 — the dropdown and the table both read as if the
  // list had been shuffled.
  it("orders them as numbers, not as text", () => {
    const codes = subUnitsOf([
      member({ unitCode: "13003", unitName: "ก" }),
      member({ unitCode: "103003", unitName: "ข" }),
      member({ unitCode: "100", unitName: "ค" }),
      member({ unitCode: "23003", unitName: "ง" }),
    ]).map((u) => u.code);
    expect(codes).toEqual(["100", "13003", "23003", "103003"]);
  });
});
