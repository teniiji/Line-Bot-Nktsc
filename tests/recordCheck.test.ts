import { describe, expect, it } from "vitest";
import { recordCheckNotes } from "../lib/recordCheck";

const base = { roundLabel: "ก.ย. 2569", onRound: true, sameAmount: [] as { amount: number; date: string; where: "round" | "recorded" }[] };

describe("recordCheckNotes", () => {
  it("says a member payroll already deducted is settled, and the unit's money is that deduction", () => {
    const [n] = recordCheckNotes({ ...base, deductionResult: "collected", expectedAmount: 30960.75 });
    expect(n.tone).toBe("ok");
    expect(n.text).toMatch(/หักได้ครบแล้ว/);
    expect(n.text).toMatch(/ไม่นับซ้ำ/);
  });

  it("warns when the member has already paid their หักไม่ได้, and says what is still owed otherwise", () => {
    expect(
      recordCheckNotes({ ...base, deductionResult: "uncollected", amountDue: 5000, amountPaid: 5000 })[0].tone
    ).toBe("warn");
    const owing = recordCheckNotes({ ...base, deductionResult: "uncollected", amountDue: 5000, amountPaid: 1000 })[0];
    expect(owing.tone).toBe("info");
    expect(owing.text).toMatch(/ยังค้าง/);
  });

  it("says when the member is not on this month's round, or there is no round", () => {
    expect(recordCheckNotes({ ...base, onRound: false })[0].text).toMatch(/ไม่มีชื่อในรอบ/);
    expect(recordCheckNotes({ ...base, roundLabel: null, onRound: false })[0].text).toMatch(/ยังไม่มีรอบ/);
  });

  it("flags money of the same amount already in the round or already recorded", () => {
    const notes = recordCheckNotes({
      ...base,
      deductionResult: "awaiting",
      sameAmount: [{ amount: 30960.75, date: "2026-09-25T16:45:00.000Z", where: "recorded" }],
    });
    expect(notes).toHaveLength(2);
    expect(notes[1]).toEqual({
      tone: "warn",
      text: "⚠️ มียอด ฿30,960.75 ของคนนี้แล้ว (25/9/2569 · บันทึกไว้แล้ว) — อาจเป็นเงินก้อนเดียวกัน",
    });
  });
});
