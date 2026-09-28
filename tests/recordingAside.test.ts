import { describe, expect, it } from "vitest";
import { recordingAsideProblem, recordingExcess } from "../lib/recordingAside";

describe("recordingExcess", () => {
  it("is what a unit sent beyond ยอดแจ้งหัก", () => {
    // 29457: ฿19,320 from Udon Thani PES, แจ้งหัก ฿18,900 — ฿420 of สสค.
    expect(recordingExcess(19320, 18900)).toBe(420);
  });

  it("is nothing when the transfer is the deduction exactly, or less", () => {
    expect(recordingExcess(700, 700)).toBe(0);
    expect(recordingExcess(700.004, 700)).toBe(0);
    expect(recordingExcess(500, 700)).toBe(0);
  });

  it("is nothing when the round has no ยอดแจ้งหัก to compare with", () => {
    expect(recordingExcess(19320, null)).toBe(0);
    expect(recordingExcess(19320, 0)).toBe(0);
  });
});

describe("recordingAsideProblem", () => {
  it("allows part of a recording under a set-aside category", () => {
    expect(recordingAsideProblem(19320, 420, "สสค")).toBeNull();
  });

  it("refuses the whole recording, nothing, or an unknown category", () => {
    expect(recordingAsideProblem(19320, 19320, "สสค")).toMatch(/น้อยกว่า/);
    expect(recordingAsideProblem(19320, 0, "สสค")).toMatch(/มากกว่า 0/);
    expect(recordingAsideProblem(19320, 420, "อะไรก็ได้")).toMatch(/เลือกประเภท/);
  });
});
