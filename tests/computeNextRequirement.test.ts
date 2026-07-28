import { describe, expect, it } from "vitest";
import { computeNextRequirement } from "../lib/agent/state";
import type { LineUserInfo, PendingInfo } from "../lib/agent/types";

const basePending: PendingInfo = {
  category: null,
  amount: 1000,
  description: null,
  date: null,
  hasSlip: true,
  slipImageHash: null,
  slipImageUrl: null,
  slipIsPdf: false,
  referenceNumber: null,
  loanType: null,
  depositAccountNumber: null,
  slipSenderName: null,
  senderNameConfirmed: false,
};

const unknownMember: LineUserInfo = {
  fullName: null,
  memberNumber: null,
  verified: false,
  phone: null,
};

const knownMember: LineUserInfo = {
  fullName: "สมชาย ใจดี",
  memberNumber: "12345",
  verified: true,
  phone: null,
};

describe("computeNextRequirement", () => {
  it("behaves exactly as before when nothing is disabled (default empty set)", () => {
    expect(computeNextRequirement(unknownMember, basePending)).toBe("member_info");
    expect(computeNextRequirement(knownMember, basePending)).toBe("category");
  });

  it("skips member_info when disabled, falling through to the next check", () => {
    const next = computeNextRequirement(unknownMember, basePending, new Set(["member_info"]));
    expect(next).toBe("category");
  });

  it("skips category when disabled", () => {
    const next = computeNextRequirement(knownMember, basePending, new Set(["category"]));
    expect(next).toBeNull();
  });

  it("skips loan_type when disabled, even for a ชำระหนี้ transaction with no loan type", () => {
    const pending = { ...basePending, category: "ชำระหนี้" };
    expect(computeNextRequirement(knownMember, pending)).toBe("loan_type");
    expect(computeNextRequirement(knownMember, pending, new Set(["loan_type"]))).toBeNull();
  });

  it("skips deposit_account when disabled, even for a ฝากเงิน transaction with no account number", () => {
    const pending = { ...basePending, category: "ฝากเงิน" };
    expect(computeNextRequirement(knownMember, pending)).toBe("deposit_account");
    expect(computeNextRequirement(knownMember, pending, new Set(["deposit_account"]))).toBeNull();
  });

  it("skips confirm_sender_name when disabled, even on a name mismatch", () => {
    const pending = {
      ...basePending,
      category: "ฝากเงิน",
      depositAccountNumber: "1-2-345",
      slipSenderName: "คนอื่น ไม่ตรงกัน",
    };
    expect(computeNextRequirement(knownMember, pending)).toBe("confirm_sender_name");
    expect(
      computeNextRequirement(knownMember, pending, new Set(["confirm_sender_name"]))
    ).toBeNull();
  });

  it("never crashes on confirm_sender_name when member_info is also disabled and fullName is null", () => {
    const pending = {
      ...basePending,
      category: "ฝากเงิน",
      depositAccountNumber: "1-2-345",
      slipSenderName: "ใครสักคน",
    };
    expect(() =>
      computeNextRequirement(unknownMember, pending, new Set(["member_info"]))
    ).not.toThrow();
    expect(computeNextRequirement(unknownMember, pending, new Set(["member_info"]))).toBeNull();
  });
});
