import { describe, expect, it } from "vitest";
import { unitProgress } from "../lib/roundUnitProgress";
import { controlUnitName } from "../lib/controlUnits";

const m = (hCode: string | null, unitName: string | null, deductionResult: string) => ({ hCode, unitName, deductionResult });

describe("unitProgress", () => {
  it("groups by หน่วยคุม, counts results and names the unit", () => {
    const [row] = unitProgress([m("70", "a", "collected"), m("70", "b", "uncollected"), m("70", "b", "collected")]);
    expect(row).toMatchObject({ key: "70", members: 3, collected: 2, uncollected: 1, awaiting: 0, state: "reported" });
    expect(row.name).toBe(controlUnitName("70"));
  });

  it("tells a unit still out from one partly in, and lists who is still out", () => {
    const rows = unitProgress([
      m("50", "บำนาญ เขต1 อ.ท่าบ่อ", "awaiting"),
      m("50", "บำนาญ เขต1 อ.เมือง", "collected"),
      m("51", "x", "awaiting"),
      m("51", "x", "awaiting"),
    ]);
    expect(rows.map((r) => [r.key, r.state])).toEqual([
      ["51", "awaiting"],
      ["50", "partial"],
    ]);
    expect(rows[1].awaitingUnitNames).toEqual(["บำนาญ เขต1 อ.ท่าบ่อ"]);
  });

  it("falls back to the unit's name without a หน่วยคุม, and skips members with neither", () => {
    const rows = unitProgress([m(null, "ศึกษาธิการเลย", "uncollected"), m(null, null, "awaiting")]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "ศึกษาธิการเลย", hCode: null, name: "ศึกษาธิการเลย", state: "reported" });
  });

  it("orders codes as numbers within a state", () => {
    const rows = unitProgress([m("100", "a", "collected"), m("9", "b", "collected"), m("20", "c", "collected")]);
    expect(rows.map((r) => r.key)).toEqual(["9", "20", "100"]);
  });
});
