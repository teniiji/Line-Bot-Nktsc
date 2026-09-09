import { describe, expect, it } from "vitest";
import { CAPTURE_BEFORE_ASKING, requirementMessage } from "../lib/agent/transactionHandlers";
import type { Requirement } from "../lib/agent/types";
import { LOAN_TYPES } from "../lib/loanTypes";

// The conversation these assertions come from: a member sent a ฿30,000 slip
// and wrote "จ่ายหนี้นะคะ", then "ดำรงชีพ ATM น.ส.กาญจภัษฐ์ วงษ์สวรรค์", then
// their member number. Both the category and the loan type were in messages
// the bot had already read, and both were asked for again afterwards — the
// member said "ชำระหนี้" three times and "ATM" three times across ten bot
// messages before one repayment was logged.
const ALL: Exclude<Requirement, null>[] = [
  "member_info",
  "slip",
  "category",
  "loan_type",
  "deposit_account",
  "confirm_sender_name",
];

describe("requirementMessage", () => {
  it("tells the model to bank the rest of the message before asking, whatever it is waiting for", () => {
    // Every requirement, not just the ones that bit: the tool the runner
    // forces is chosen by the requirement, so each one is its own chance to
    // drop whatever else the member said in the same breath.
    for (const next of ALL) {
      expect(requirementMessage(next), next).toContain(CAPTURE_BEFORE_ASKING);
    }
  });

  it("still names the one thing that is actually missing", () => {
    // The carry-over instruction is an addition, not a replacement — the
    // model still has to know what to ask for when nothing carries over.
    expect(requirementMessage("member_info")).toContain("เลขสมาชิก");
    expect(requirementMessage("slip")).toContain("slip");
    expect(requirementMessage("category")).toContain("ซื้อหุ้น");
    expect(requirementMessage("loan_type")).toContain(LOAN_TYPES[1]);
    expect(requirementMessage("deposit_account")).toContain("ฝากเงิน");
    expect(requirementMessage("confirm_sender_name")).toContain("sender name");
  });

  it("says nothing at all when nothing is missing", () => {
    // null is "ready to log". A carry-over instruction here would tell the
    // model to keep collecting after the transaction is already complete.
    expect(requirementMessage(null)).toBe("");
  });

  it("names each tool the model must call instead of asking again", () => {
    expect(CAPTURE_BEFORE_ASKING).toContain("report_transaction");
    expect(CAPTURE_BEFORE_ASKING).toContain("submit_loan_type");
    expect(CAPTURE_BEFORE_ASKING).toContain("submit_deposit_account");
  });

  it("puts the category before the loan type, which is the order that works", () => {
    // submit_loan_type refuses a transaction whose category is not ชำระหนี้
    // yet, so a message carrying both has to be banked category-first or the
    // second call fails and the loan type is lost anyway.
    const category = CAPTURE_BEFORE_ASKING.indexOf("report_transaction");
    const loanType = CAPTURE_BEFORE_ASKING.indexOf("submit_loan_type");
    expect(category).toBeGreaterThan(-1);
    expect(loanType).toBeGreaterThan(category);
    expect(CAPTURE_BEFORE_ASKING).toContain("ชำระหนี้");
  });

  it("forbids re-asking in plain words, not only by implication", () => {
    // The failure was never that the model lacked the information — it was
    // that nothing told it the information was there. Both halves are said.
    expect(CAPTURE_BEFORE_ASKING).toContain("re-read");
    expect(CAPTURE_BEFORE_ASKING).toContain("NEVER ask the member for something they have already told you");
  });

  it("starts with a separator, so it cannot run into the sentence before it", () => {
    expect(CAPTURE_BEFORE_ASKING.startsWith(" ")).toBe(true);
  });
});
