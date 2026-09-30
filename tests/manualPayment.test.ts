import { describe, expect, it } from "vitest";
import {
  MANUAL_PAYMENT,
  isManualPaymentAccount,
  isManualPaymentBranch,
  manualPaymentMethodOf,
  parseManualPaymentMethod,
} from "../lib/manualPayment";
import { matchesStatus } from "../lib/statementFilters";
import { summarizeStatementFiles } from "../lib/roundStatementFiles";
import { StatementMemberRow } from "../lib/types";

describe("manual payments", () => {
  it("records cash unless an internal transfer is asked for", () => {
    expect(parseManualPaymentMethod("internal")).toBe("internal");
    expect(parseManualPaymentMethod("cash")).toBe("cash");
    expect(parseManualPaymentMethod(undefined)).toBe("cash");
    expect(parseManualPaymentMethod("anything")).toBe("cash");
  });

  it("stores an internal transfer under its own words, never a bank account", () => {
    expect(MANUAL_PAYMENT.internal).toMatchObject({ accountNumber: "โอนภายใน", account: "internal", branch: "โอนภายใน" });
    expect(isManualPaymentAccount("internal")).toBe(true);
    expect(isManualPaymentAccount("cash")).toBe(true);
    expect(isManualPaymentAccount("413")).toBe(false);
    expect(isManualPaymentBranch("โอนภายใน")).toBe(true);
    expect(isManualPaymentBranch("หนองคาย")).toBe(false);
  });

  it("tags only rows staff recorded that way", () => {
    expect(manualPaymentMethodOf({ manualMemberNumber: true, accountNumber: "โอนภายใน" })).toBe("internal");
    expect(manualPaymentMethodOf({ manualMemberNumber: true, accountNumber: "เงินสด" })).toBe("cash");
    expect(manualPaymentMethodOf({ manualMemberNumber: false, accountNumber: "โอนภายใน" })).toBeNull();
    expect(manualPaymentMethodOf({ manualMemberNumber: true, accountNumber: "4130024744" })).toBeNull();
  });

  it("lists an internal transfer under 💵 เงินสด / โอนภายใน, alone or beside a bank transfer", () => {
    const row = (paidBranch: string | null) => ({ paidBranch }) as StatementMemberRow;
    expect(matchesStatus(row("โอนภายใน"), "cash")).toBe(true);
    expect(matchesStatus(row("หนองคาย + โอนภายใน"), "cash")).toBe(true);
    expect(matchesStatus(row("เงินสด"), "cash")).toBe(true);
    expect(matchesStatus(row("หนองคาย"), "cash")).toBe(false);
    expect(matchesStatus(row(null), "cash")).toBe(false);
  });

  it("never lists an internal transfer as a Statement file", () => {
    const files = summarizeStatementFiles([
      { id: "1", account: "internal", branch: "โอนภายใน", sourceFile: null, fingerprint: "internal:r:29401:x", amount: 6500, transferredAt: null } as never,
    ]);
    expect(files).toEqual([]);
  });
});
