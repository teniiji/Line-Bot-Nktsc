import { describe, expect, it } from "vitest";
import { memberContactNote, memberNote, parseRecordTarget, recordCheckNotes, recordTargetValue } from "../lib/recordCheck";

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

  it("says the round already counts this very line, instead of warning it may be a second payment", () => {
    // 29571: ฿4,840 read into the round from its statement, then opened on the daily page.
    const notes = recordCheckNotes({
      ...base,
      thisLineCounted: true,
      deductionResult: "uncollected",
      amountDue: 4840,
      amountPaid: 4840,
    });
    expect(notes).toEqual([
      {
        tone: "ok",
        text: "✅ ยอดนี้นับในรอบ ก.ย. 2569 แล้ว · ครบ — ไม่ต้องบันทึกซ้ำ ถ้าต้องการให้มีในแถบธุรกรรมของสมาชิก บันทึกได้ ระบบไม่นับซ้ำ",
      },
    ]);
  });
});


describe("record targets", () => {
  it("round-trips a round or a carried debt, and nothing else", () => {
    expect(parseRecordTarget(recordTargetValue({ kind: "round", id: "r1" }))).toEqual({ kind: "round", id: "r1" });
    expect(parseRecordTarget("debt:cmx9")).toEqual({ kind: "debt", id: "cmx9" });
    expect(parseRecordTarget("")).toBeNull();
    expect(parseRecordTarget("member:1")).toBeNull();
    expect(parseRecordTarget(undefined)).toBeNull();
  });
});

describe("who the typed number is", () => {
  it("names the member from the register, with สังกัด and LINE", () => {
    expect(memberNote({ name: "นางสาวทดสอบ ใจดี", unitName: "ร.ร.บ้านหนองหอย", inRoster: true, onLine: true })).toEqual({
      tone: "ok",
      text: "👤 นางสาวทดสอบ ใจดี · ร.ร.บ้านหนองหอย · เชื่อม LINE แล้ว",
    });
  });

  it("says when the name came only from the round", () => {
    expect(memberNote({ name: "นายทดสอบ", unitName: null, inRoster: false, onLine: false })?.text).toContain(
      "ยังไม่มีในทะเบียนสมาชิก"
    );
  });

  it("warns about a number nobody has", () => {
    expect(memberNote(null)?.tone).toBe("warn");
  });

  it("comes first among the notes, and stays out when not looked up", () => {
    const base = { roundLabel: null, onRound: false, sameAmount: [] };
    expect(recordCheckNotes({ ...base, member: null })[0].text).toContain("ไม่พบเลขสมาชิกนี้");
    expect(recordCheckNotes(base)[0].text).toBe("ยังไม่มีรอบหักไม่ได้ของเดือนที่เงินเข้า");
  });
});

describe("the member's phone and accounts", () => {
  const who = { name: "นางสาวทดสอบ ใจดี", unitName: null, inRoster: true, onLine: false };

  it("lists the phone and bound accounts, marking the one this money came from", () => {
    expect(
      memberContactNote({
        ...who,
        phone: "0812345678",
        accounts: [
          { accountNumber: "4130001111", paidFrom: false },
          { accountNumber: "4960599999", paidFrom: true },
        ],
      })?.text
    ).toBe("📞 0812345678 · 🏦 บัญชีที่ผูกไว้: 4130001111, 4960599999 (บัญชีที่โอนมานี้)");
  });

  it("says when no account is bound", () => {
    expect(memberContactNote({ ...who, phone: null, accounts: [] })?.text).toBe("🏦 ยังไม่ได้ผูกเลขบัญชี");
  });

  it("says nothing for a number nobody has", () => {
    expect(memberContactNote(null)).toBeNull();
  });
});
