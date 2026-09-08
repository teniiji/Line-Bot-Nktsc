import { describe, expect, it } from "vitest";
import {
  ALREADY_RECORDED_ERROR,
  accountCaveat,
  canBindAccount,
  describeDepositRecord,
  recordProblem,
  senderAccountIsPayer,
} from "../lib/depositRecord";

describe("senderAccountIsPayer", () => {
  it("treats an app or mobile transfer's digits as the payer's own account", () => {
    // "TR fr 4131386828" — the ฿80,000 at 08:17 on 8 Sep.
    expect(senderAccountIsPayer("transfer")).toBe(true);
    expect(senderAccountIsPayer("mobile")).toBe(true);
  });

  it("does not treat a counter deposit's digits as an account", () => {
    // The ฿29,054 at 10:48, described as "034-018248093813". Somebody paid
    // cash at a branch; there is no paying account anywhere in that.
    expect(senderAccountIsPayer("counter")).toBe(false);
  });
});

describe("accountCaveat", () => {
  it("says nothing about a plain transfer", () => {
    expect(accountCaveat("transfer")).toBeNull();
    expect(accountCaveat("mobile")).toBeNull();
  });

  it("explains why binding a counter deposit's digits is useless", () => {
    const caveat = accountCaveat("counter");
    expect(caveat).toContain("เลขอ้างอิงใบฝาก");
    // The consequence, not just the fact: a binding that will never match
    // again is the part staff need to hear before they make one.
    expect(caveat).toContain("ครั้งหน้า");
  });

  it("admits uncertainty for a channel nobody has checked, rather than guessing", () => {
    // ATM, e-wallet and cheque have not been confirmed either way against a
    // real statement. Claiming they are payer accounts would be a guess, and
    // refusing them outright would block staff who know better.
    for (const channel of ["atm", "ewallet", "cheque"]) {
      expect(accountCaveat(channel)).toContain("ยังไม่แน่ใจ");
    }
  });
});

describe("canBindAccount", () => {
  it("allows a caveated channel — the caveat is a warning, not a refusal", () => {
    expect(canBindAccount({ senderAccount: "018248093813" })).toBe(true);
  });

  it("refuses only when the statement named no digits at all", () => {
    expect(canBindAccount({ senderAccount: null })).toBe(false);
  });
});

describe("recordProblem", () => {
  it("accepts a member number with a category the cooperative uses", () => {
    expect(recordProblem({ memberNumber: "29252", category: "ชำระหนี้" })).toBeNull();
  });

  it("refuses a blank member number", () => {
    expect(recordProblem({ memberNumber: "   ", category: "ชำระหนี้" })).toContain("เลขสมาชิก");
  });

  it("refuses a category that is not one of the cooperative's", () => {
    // The category decides which department gets told about the payment, so
    // an invented one would file money nobody is watching for.
    expect(recordProblem({ memberNumber: "29252", category: "อื่นๆ" })).not.toBeNull();
    expect(recordProblem({ memberNumber: "29252", category: "" })).not.toBeNull();
  });
});

describe("describeDepositRecord", () => {
  const deposit = {
    postedAt: new Date("2026-09-08T10:48:00.000Z"),
    senderAccount: "018248093813",
    branch: "413 หนองคาย",
  };

  it("says it came from the statement, not from a slip", () => {
    const text = describeDepositRecord(deposit, null);
    expect(text).toContain("บันทึกจาก statement");
    expect(text).toContain("ไม่มีสลิป");
  });

  it("carries the three things needed to find the line in the bank's export", () => {
    const text = describeDepositRecord(deposit, null);
    // The bank's timestamps hold its wall clock in UTC, so the clock printed
    // here is the one the statement shows — not the server's local time.
    expect(text).toContain("10:48");
    expect(text).toContain("018248093813");
    expect(text).toContain("413 หนองคาย");
  });

  it("keeps a note staff added", () => {
    expect(describeDepositRecord(deposit, "  โทรถามแล้ว ยืนยันเอง  ")).toContain(
      "โทรถามแล้ว ยืนยันเอง"
    );
  });

  it("leaves out what the line does not have", () => {
    const text = describeDepositRecord(
      { postedAt: null, senderAccount: null, branch: "447 บึงกาฬ" },
      ""
    );
    expect(text).toContain("447 บึงกาฬ");
    expect(text).not.toContain("จากบัญชี");
    expect(text).not.toContain("น.");
  });
});

describe("ALREADY_RECORDED_ERROR", () => {
  it("tells staff what to do instead of just refusing", () => {
    // Two people working the same eight rows is the ordinary case, not a bug.
    expect(ALREADY_RECORDED_ERROR).toContain("ถูกบันทึกเป็นรายการไปแล้ว");
    expect(ALREADY_RECORDED_ERROR).toContain("ลบ");
  });
});
