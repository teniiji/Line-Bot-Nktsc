import { describe, expect, it } from "vitest";
import { depositAccountLine } from "../lib/depositNotice";

describe("depositAccountLine", () => {
  it("names the account when the bot has it", () => {
    expect(depositAccountLine("ฝากเงิน", "30-00030096")).toContain("30-00030096");
    expect(depositAccountLine("ฝากเงิน", "30-00030096")).toContain("เลขที่บัญชีที่ฝาก");
  });

  it("says the account is missing rather than printing nothing", () => {
    // The whole point. With ask_deposit_account_enabled switched off the bot
    // stops asking — which is what stops members being looped — so the
    // question moves to staff, and it only moves if they can see it.
    const line = depositAccountLine("ฝากเงิน", null);
    expect(line).toContain("ไม่ได้แจ้ง");
    expect(line).toContain("ต้องสอบถามสมาชิกเพิ่ม");
  });

  it("says nothing about a deposit account on a category that has none", () => {
    // "not given" on a ชำระหนี้ would be noise about a field that never
    // applied to it.
    expect(depositAccountLine("ชำระหนี้", null)).toBe("");
    expect(depositAccountLine("ซื้อหุ้น", null)).toBe("");
  });

  it("still shows an account number that somehow reached another category", () => {
    // Nothing stops a number being on the row; if it is there, staff should
    // see it rather than have it dropped for failing a category check.
    expect(depositAccountLine("ชำระหนี้", "30-00030096")).toContain("30-00030096");
  });

  it("starts on its own line, so it cannot run into the field above it", () => {
    expect(depositAccountLine("ฝากเงิน", "30-00030096").startsWith("\n")).toBe(true);
    expect(depositAccountLine("ฝากเงิน", null).startsWith("\n")).toBe(true);
  });
});
