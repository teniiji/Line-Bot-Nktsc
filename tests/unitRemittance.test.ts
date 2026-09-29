import { describe, expect, it } from "vitest";
import { isUnitRemittance, remittanceOverlap, unitRemittanceByMember } from "../lib/unitRemittance";
import { matchesStatus } from "../lib/statementFilters";
import type { StatementMemberRow } from "../lib/types";

const unitLine = "Pathumthani 2/สำนักงานเขตพื้นที่การศึกษา";

describe("isUnitRemittance", () => {
  it("is a share of a lump sum divided on the daily page", () => {
    expect(isUnitRemittance({ fingerprint: "line:413|x#29375", accountNumber: "", description: `${unitLine} (แบ่งจาก ฿60,000.00)` })).toBe(true);
    // Divided even when the bank named an account: the office paid from its own.
    expect(isUnitRemittance({ fingerprint: "line:413|x#29375", accountNumber: "4130000000", description: "TR fr 4130000000" })).toBe(true);
  });

  it("is a unit's line put whole on one member", () => {
    expect(isUnitRemittance({ fingerprint: "line:413|y", accountNumber: "", description: unitLine })).toBe(true);
  });

  it("is not a member's own transfer, cash at the counter, or a file row", () => {
    expect(isUnitRemittance({ fingerprint: "line:413|y", accountNumber: "4130059483", description: "TR fr 4130059483" })).toBe(false);
    expect(isUnitRemittance({ fingerprint: "line:413|z", accountNumber: "", description: "ฝากเงินสด" })).toBe(false);
    expect(isUnitRemittance({ fingerprint: "447|4470313378|5600.00|2026-09-23|1.00|0", accountNumber: "4470313378", description: "TR fr 4470313378" })).toBe(false);
    // Split to another member on the round page: family money, not a unit's.
    expect(isUnitRemittance({ fingerprint: "447|a|1.00|d|1.00|0::split:x", accountNumber: "4470313378", description: "TR fr 4470313378" })).toBe(false);
  });
});

describe("unitRemittanceByMember", () => {
  it("adds up each member's shares, leaving out rows marked as for something else", () => {
    const share = (memberNumber: string, amount: number, excludedReason: string | null = null) => ({
      fingerprint: `line:413|x#${memberNumber}`,
      accountNumber: "",
      description: unitLine,
      memberNumber,
      amount,
      excludedReason,
    });
    const out = unitRemittanceByMember([share("1", 1000), share("1", 500.5), share("2", 700, "ซื้อหุ้น")]);
    expect(out.get("1")).toBe(1500.5);
    expect(out.has("2")).toBe(false);
  });
});

describe("remittanceOverlap", () => {
  it("names the same deduction heard twice, and a share on someone payroll could not deduct", () => {
    expect(remittanceOverlap({ deductionResult: "collected", unitRemittance: 3000 })).toBe("collected");
    expect(remittanceOverlap({ deductionResult: "uncollected", unitRemittance: 3000 })).toBe("uncollected");
    expect(remittanceOverlap({ deductionResult: "awaiting", unitRemittance: 3000 })).toBeNull();
    expect(remittanceOverlap({ deductionResult: "collected", unitRemittance: 0 })).toBeNull();
  });

  it("is what the filter chips count by", () => {
    const m = { deductionResult: "uncollected", unitRemittance: 2600, status: "paid" } as StatementMemberRow;
    expect(matchesStatus(m, "unit_uncollected")).toBe(true);
    expect(matchesStatus(m, "unit_collected")).toBe(false);
  });
});
