import { describe, expect, it } from "vitest";
import { planDeductionUpload, wasSeeded } from "../lib/deductionUpload";
import type { DeductionSheetRow } from "../lib/statementReconcile";

const row = (
  memberNumber: string,
  result: DeductionSheetRow["result"],
  amountDue = 0
): DeductionSheetRow => ({
  memberNumber,
  name: `สมาชิก ${memberNumber}`,
  unitName: "โรงเรียนบ้านโนนสวรรค์",
  hCode: "1",
  note: null,
  accountNumber: "4131234567",
  expectedAmount: 5000,
  amountDue,
  result,
});

const inRound = (memberNumber: string, deductionResult: string) => ({
  memberNumber,
  deductionResult,
});

describe("planDeductionUpload", () => {
  it("adds the members a round has never seen", () => {
    const plan = planDeductionUpload([], [row("1", "awaiting"), row("2", "awaiting")]);
    expect(plan.create).toHaveLength(2);
    expect(plan.update).toHaveLength(0);
  });

  it("updates the members it already has", () => {
    const plan = planDeductionUpload(
      [inRound("1", "awaiting")],
      [row("1", "uncollected", 5000)]
    );
    expect(plan.update.map((r) => r.memberNumber)).toEqual(["1"]);
    expect(plan.create).toHaveLength(0);
  });

  it("leaves alone the members the sheet says nothing about", () => {
    // One unit's file covers forty people. The other eleven hundred are not
    // finished — they are simply not in this file.
    const plan = planDeductionUpload(
      [inRound("1", "awaiting"), inRound("2", "awaiting"), inRound("3", "awaiting")],
      [row("1", "collected")]
    );
    expect(plan.untouched).toBe(2);
    expect(plan.update.map((r) => r.memberNumber)).toEqual(["1"]);
  });

  it("never lets a row with no result overwrite a result already recorded", () => {
    // Re-uploading the รายการหัก after some units have replied is ordinary —
    // a correction, a late addition. If "รอผล" won, it would quietly
    // un-answer every unit that had already reported.
    const plan = planDeductionUpload(
      [inRound("1", "uncollected"), inRound("2", "collected")],
      [row("1", "awaiting"), row("2", "awaiting")]
    );
    expect(plan.update).toHaveLength(0);
    expect(plan.keptResult.map((r) => r.memberNumber)).toEqual(["1", "2"]);
  });

  it("does let a result replace another result", () => {
    // A unit that corrects its own file has to be able to change its answer.
    const plan = planDeductionUpload(
      [inRound("1", "uncollected")],
      [row("1", "collected")]
    );
    expect(plan.update.map((r) => r.result)).toEqual(["collected"]);
  });

  it("re-reports a member the round is still awaiting", () => {
    const plan = planDeductionUpload([inRound("1", "awaiting")], [row("1", "awaiting")]);
    expect(plan.update).toHaveLength(1);
    expect(plan.keptResult).toHaveLength(0);
  });

  it("counts a member named twice in one file once", () => {
    const plan = planDeductionUpload(
      [inRound("1", "awaiting"), inRound("2", "awaiting")],
      [row("1", "collected"), row("1", "collected")]
    );
    expect(plan.untouched).toBe(1);
  });
});

describe("wasSeeded", () => {
  it("knows a round that started from the รายการหัก", () => {
    expect(wasSeeded([{ deductionResult: "awaiting", expectedAmount: 5000 }])).toBe(true);
    // Every unit has since replied, but the ยอดแจ้งหัก is still there.
    expect(wasSeeded([{ deductionResult: "uncollected", expectedAmount: 5000 }])).toBe(true);
  });

  it("knows a round built the old way, from the results alone", () => {
    // These rounds must keep behaving exactly as they did: the sheet is the
    // round, and a corrected one drops whoever fell off it.
    expect(wasSeeded([{ deductionResult: "uncollected", expectedAmount: null }])).toBe(false);
    expect(wasSeeded([])).toBe(false);
  });
});
