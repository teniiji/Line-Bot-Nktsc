import { describe, expect, it } from "vitest";
import {
  isUnitPayerLine,
  matchUnitLines,
  payerKey,
  splitFingerprint,
  splitProblem,
  soleOwing,
  splitSourceOf,
  suggestedPayerName,
  unitMatchMode,
  unitMemberProblem,
} from "../lib/unitPayer";

describe("payerKey", () => {
  it("keeps the payer and drops the per-transfer reference", () => {
    expect(payerKey("KHON KAEN CM TA/เทศบาลนครขอนแก่น/200405")).toBe("khon kaen cm ta/เทศบาลนครขอนแก่น");
    expect(payerKey("KHON KAEN CM TA/เทศบาลนครขอนแก่น/200512")).toBe("khon kaen cm ta/เทศบาลนครขอนแก่น");
  });

  it("evens out spacing and case", () => {
    expect(payerKey("Kalasin  PESA 2 /สนง.เขตพื้นที่การศึกษาฯ")).toBe(payerKey("KALASIN PESA 2/สนง.เขตพื้นที่การศึกษาฯ"));
  });

  it("has nothing to go on for an empty or number-only description", () => {
    expect(payerKey("")).toBeNull();
    expect(payerKey("200405")).toBeNull();
  });
});

describe("suggestedPayerName", () => {
  it("offers the statement's own words", () => {
    expect(suggestedPayerName("Kalasin PESA 2/สนง.เขตพื้นที่การศึกษาฯ")).toBe("Kalasin PESA 2 / สนง.เขตพื้นที่การศึกษาฯ");
  });
});

describe("splitProblem", () => {
  it("accepts parts that add up to the line exactly", () => {
    expect(
      splitProblem(29200, [
        { memberNumber: "11111", amount: 14600 },
        { memberNumber: "22222", amount: 14600 },
      ])
    ).toBeNull();
  });

  it("says how much is left over or too much", () => {
    expect(splitProblem(29200, [{ memberNumber: "11111", amount: 14600 }])).toContain("ขาดอีก 14600.00");
    expect(
      splitProblem(1000, [
        { memberNumber: "11111", amount: 700 },
        { memberNumber: "22222", amount: 500 },
      ])
    ).toContain("เกินมา 200.00");
  });

  it("refuses a member twice, a blank member and a zero amount", () => {
    expect(
      splitProblem(200, [
        { memberNumber: "011111", amount: 100 },
        { memberNumber: "11111", amount: 100 },
      ])
    ).toContain("ซ้ำ");
    expect(splitProblem(100, [{ memberNumber: "", amount: 100 }])).toContain("เลขสมาชิก");
    expect(
      splitProblem(100, [
        { memberNumber: "11111", amount: 100 },
        { memberNumber: "22222", amount: 0 },
      ])
    ).toContain("มากกว่า 0");
    expect(splitProblem(100, [])).toBe("ยังไม่ได้ใส่สมาชิก");
  });
});

describe("splitFingerprint", () => {
  it("names the line and the member, one row per member", () => {
    expect(splitFingerprint("413|abc", "011111")).toBe("line:413|abc#11111");
  });
});

describe("splitSourceOf", () => {
  it("reads a share divided on the daily page back to its bank line", () => {
    expect(splitSourceOf(splitFingerprint("abc123", "029427"))).toEqual({
      kind: "line",
      lineFingerprint: "abc123",
    });
  });

  it("reads a share split off inside the round back to the row it came from", () => {
    expect(splitSourceOf("fp-9::split:1b2c")).toEqual({ kind: "round", parentFingerprint: "fp-9" });
  });

  it("leaves whole lines alone, bridged ones included", () => {
    expect(splitSourceOf("fp-9")).toBeNull();
    expect(splitSourceOf("line:abc123")).toBeNull();
  });
});

describe("isUnitPayerLine", () => {
  it("recognises an office named between slashes", () => {
    expect(isUnitPayerLine("Education Coun/สำนักงานเลขาธิการสภาการศึกษา")).toBe(true);
    expect(isUnitPayerLine("KHON KAEN CM TA/เทศบาลนครขอนแก่น/200405")).toBe(true);
  });

  it("does not take a QR code, a cheque's writer or an account for a unit", () => {
    expect(isUnitPayerLine("010753700088205-BU0994005S00999915K")).toBe(false);
    expect(isUnitPayerLine("วิจิตร พุกาธร 0817396469")).toBe(false);
    expect(isUnitPayerLine("TR fr 4131150565")).toBe(false);
    expect(isUnitPayerLine("0012/345")).toBe(false);
    expect(isUnitPayerLine("")).toBe(false);
  });
});

describe("unitMatchMode", () => {
  it("recognises a one-member unit on its own and lists a larger one to divide", () => {
    expect(unitMatchMode(0)).toBe("none");
    expect(unitMatchMode(1)).toBe("auto");
    expect(unitMatchMode(3)).toBe("split");
  });
});

describe("unitMemberProblem", () => {
  it("refuses a malformed number and one already on the unit, however written", () => {
    expect(unitMemberProblem("abc", [])).not.toBeNull();
    expect(unitMemberProblem("031132", ["31132"])).toBe("สมาชิกคนนี้อยู่ในหน่วยงานนี้แล้ว");
    expect(unitMemberProblem("31133", ["31132"])).toBeNull();
  });
});

describe("matchUnitLines", () => {
  const day = "2026-09-24";
  const line = (id: string, amount: number, d = day) => ({ id, amount, day: d });

  it("tells a unit's one-per-member transfers apart by last month's amounts", () => {
    // UdonThani Prim: seven lines at 10:40, one per member.
    const out = matchUnitLines(
      [line("a", 13220), line("b", 3020), line("c", 17700)],
      [
        { memberNumber: "29001", lastAmount: 13220 },
        { memberNumber: "29002", lastAmount: 3020 },
        { memberNumber: "29003", lastAmount: 99999 },
      ]
    );
    expect(out.get("a")).toBe("29001");
    expect(out.get("b")).toBe("29002");
    expect(out.has("c")).toBe(false);
  });

  it("names nobody where the amount could be two members or two lines", () => {
    const twoMembers = matchUnitLines(
      [line("a", 13220)],
      [
        { memberNumber: "29001", lastAmount: 13220 },
        { memberNumber: "29002", lastAmount: 13220 },
      ]
    );
    expect(twoMembers.size).toBe(0);
    const twoLines = matchUnitLines(
      [line("a", 13220), line("b", 13220)],
      [
        { memberNumber: "29001", lastAmount: 13220 },
        { memberNumber: "29002", lastAmount: 500 },
      ]
    );
    expect(twoLines.size).toBe(0);
  });

  it("gives a one-member unit its only line of the day whatever the amount", () => {
    const out = matchUnitLines([line("a", 750)], [{ memberNumber: "31132", lastAmount: 700 }]);
    expect(out.get("a")).toBe("31132");
  });

  it("does not hand a one-member unit's several lines all to that member", () => {
    // Once one of UdonThani's members is recorded, the other six lines that
    // day must not all become theirs.
    const out = matchUnitLines(
      [line("a", 13220), line("b", 3020)],
      [{ memberNumber: "29001", lastAmount: 13220 }]
    );
    expect(out.get("a")).toBe("29001");
    expect(out.has("b")).toBe(false);
  });

  it("judges each day on its own across a date range", () => {
    const out = matchUnitLines(
      [line("sep", 700, "2026-09-10"), line("oct", 720, "2026-10-10")],
      [{ memberNumber: "31132", lastAmount: 700 }]
    );
    expect(out.get("sep")).toBe("31132");
    expect(out.get("oct")).toBe("31132");
  });
});

describe("soleOwing", () => {
  it("offers the one member owing exactly the amount", () => {
    expect(
      soleOwing(13934, [
        { memberNumber: "29001", owed: 13934 },
        { memberNumber: "29002", owed: 500 },
      ])
    ).toEqual({ memberNumber: "29001", owed: 13934 });
  });

  it("offers nobody when the amount fits several, or none", () => {
    expect(
      soleOwing(1000, [
        { memberNumber: "29001", owed: 1000 },
        { memberNumber: "29002", owed: 1000 },
      ])
    ).toBeNull();
    expect(soleOwing(1000, [{ memberNumber: "29001", owed: 900 }])).toBeNull();
  });
});

describe("matchUnitLines, amounts that change month to month", () => {
  const line = (id: string, amount: number) => ({ id, amount, day: "2026-10-24", period: "1069" });

  it("names a member by this month's ยอดแจ้งหัก when last month's no longer fits", () => {
    const out = matchUnitLines(
      [line("a", 13500), line("b", 3020)],
      [
        { memberNumber: "29001", lastAmount: 13220, current: { "1069": [13500] } },
        { memberNumber: "29002", lastAmount: 3020, current: { "1069": [3100] } },
      ]
    );
    expect(out.get("a")).toBe("29001");
    // Not this month's figure, but still last month's — and nobody else's.
    expect(out.get("b")).toBe("29002");
  });

  it("does not give one member two lines", () => {
    const out = matchUnitLines(
      [line("a", 13500), line("b", 13220)],
      [
        { memberNumber: "29001", lastAmount: 13220, current: { "1069": [13500] } },
        { memberNumber: "29002", lastAmount: 700 },
      ]
    );
    expect(out.get("a")).toBe("29001");
    expect(out.has("b")).toBe(false);
  });

  it("leaves a line alone when this month's figure fits two members", () => {
    const out = matchUnitLines(
      [line("a", 5000)],
      [
        { memberNumber: "29001", lastAmount: null, current: { "1069": [5000] } },
        { memberNumber: "29002", lastAmount: null, current: { "1069": [5000] } },
      ]
    );
    expect(out.size).toBe(0);
  });
});
