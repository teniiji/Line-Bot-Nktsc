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

describe("which sheet may say what a member's หน่วยคุม is", () => {
  // A unit's result file has one code column headed "รหัสหน่วย", and what is
  // in it is that unit's own สังกัด code: 108, 508, 1101, 1201. None of those
  // is one of the cooperative's 64 หน่วยคุม, and nothing about the number
  // says so — 108 is exactly as short as 100, which is one. Letting such a
  // file overwrite the round's coding filled the หน่วยคุม list with units
  // that do not exist.
  const fromUnitFile = { ...row("1", "uncollected", 5000), hCode: "108", unitCode: null };
  const inRoundAt = (hCode: string | null) => ({
    memberNumber: "1",
    deductionResult: "awaiting",
    hCode,
  });

  it("keeps the round's หน่วยคุม when the sheet cannot tell one from a สังกัด", () => {
    const plan = planDeductionUpload([inRoundAt("100")], [fromUnitFile]);
    expect(plan.update[0].hCode).toBeNull();
    expect(plan.keptUnit).toBe(1);
  });

  it("still records the result from that same sheet", () => {
    // Only the หน่วยคุม is held back — the answer the unit sent is the point
    // of the upload.
    const plan = planDeductionUpload([inRoundAt("100")], [fromUnitFile]);
    expect(plan.update[0]).toMatchObject({ result: "uncollected", amountDue: 5000 });
  });

  it("fills the หน่วยคุม in where the round has none", () => {
    const plan = planDeductionUpload([inRoundAt(null)], [fromUnitFile]);
    expect(plan.update[0].hCode).toBe("108");
    expect(plan.keptUnit).toBe(0);
  });

  it("re-codes even a member whose result the ไฟล์รวม may not touch", () => {
    // The "no result never overwrites a result" rule is about the result.
    // Applied to the whole row it left exactly the members whose unit had
    // already answered stuck with that unit's internal code.
    const plan = planDeductionUpload(
      [{ memberNumber: "1", deductionResult: "uncollected", hCode: "108" }],
      [{ ...row("1", "awaiting"), hCode: "100", unitCode: "108" }],
      { unitsAreAuthoritative: true }
    );
    expect(plan.keptResult).toHaveLength(1);
    expect(plan.recode.map((r) => r.hCode)).toEqual(["100"]);
    expect(plan.update).toHaveLength(0);
  });

  it("does not re-code from a sheet that cannot tell the two apart", () => {
    const plan = planDeductionUpload(
      [{ memberNumber: "1", deductionResult: "uncollected", hCode: "100" }],
      [{ ...row("1", "awaiting"), hCode: "108" }]
    );
    expect(plan.keptResult).toHaveLength(1);
    expect(plan.recode).toHaveLength(0);
  });

  it("lets the ไฟล์รวม correct it, because that file keeps the two apart", () => {
    const plan = planDeductionUpload(
      [inRoundAt("108")],
      [{ ...row("1", "awaiting"), hCode: "100", unitCode: "108" }],
      { unitsAreAuthoritative: true }
    );
    expect(plan.update[0].hCode).toBe("100");
    expect(plan.keptUnit).toBe(0);
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
