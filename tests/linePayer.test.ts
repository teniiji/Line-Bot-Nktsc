import { describe, expect, it } from "vitest";
import { payerNamed, payersByKey, resolveLinePayer } from "../lib/linePayer";

const nk = { id: "nk", name: "สพม.หนองคาย" };
const ks = { id: "ks", name: "สพม.กาฬสินธุ์" };

describe("resolveLinePayer", () => {
  it("names the only unit with a wording, as before", () => {
    expect(resolveLinePayer([nk], null)).toEqual({ payer: nk, choices: [] });
  });

  it("asks when several units share the wording and nobody chose", () => {
    expect(resolveLinePayer([nk, ks], null)).toEqual({ payer: null, choices: [nk, ks] });
  });

  it("takes the unit chosen for the line, still offering the others", () => {
    expect(resolveLinePayer([nk, ks], "ks")).toEqual({ payer: ks, choices: [nk, ks] });
  });

  it("ignores a choice no longer among the units, and knows nothing without any", () => {
    expect(resolveLinePayer([nk, ks], "gone")).toEqual({ payer: null, choices: [nk, ks] });
    expect(resolveLinePayer([], null)).toEqual({ payer: null, choices: [] });
  });
});

describe("payersByKey", () => {
  it("groups units sharing a wording, in Thai order", () => {
    const map = payersByKey([
      { id: "nk", key: "the secondary/สนง.เขตพื้นที่การศึกษามัธ", name: "สพม.หนองคาย" },
      { id: "ks", key: "the secondary/สนง.เขตพื้นที่การศึกษามัธ", name: "สพม.กาฬสินธุ์" },
      { id: "x", key: "other", name: "อื่น" },
    ]);
    expect(map.get("the secondary/สนง.เขตพื้นที่การศึกษามัธ")?.map((p) => p.id)).toEqual(["ks", "nk"]);
    expect(map.get("other")).toHaveLength(1);
  });
});

describe("payerNamed", () => {
  it("finds a unit by name, spacing and case aside", () => {
    expect(payerNamed([nk, ks], " สพม. กาฬสินธุ์ ")).toEqual(ks);
    expect(payerNamed([nk, ks], "สพม.เลย")).toBeNull();
    expect(payerNamed([nk, ks], "")).toBeNull();
  });
});
