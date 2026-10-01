import { describe, expect, it } from "vitest";
import { parseDebtPaymentQuery, sortSources, type DebtPaymentSource } from "../lib/debtPaymentSearch";

describe("parseDebtPaymentQuery", () => {
  it("reads an amount however the slip wrote it", () => {
    expect(parseDebtPaymentQuery("18000")).toEqual({ amount: 18000 });
    expect(parseDebtPaymentQuery("18,000.00")).toEqual({ amount: 18000 });
    expect(parseDebtPaymentQuery("฿4,870.50")).toEqual({ amount: 4870.5 });
  });

  it("reads six or more digits as the account the money came from", () => {
    expect(parseDebtPaymentQuery("4301008047")).toEqual({ account: "4301008047" });
    expect(parseDebtPaymentQuery("430-1-00804-7")).toEqual({ account: "4301008047" });
  });

  it("refuses what is neither", () => {
    expect(parseDebtPaymentQuery("")).toBeNull();
    expect(parseDebtPaymentQuery("ชูศักดิ์")).toBeNull();
    expect(parseDebtPaymentQuery("0")).toBeNull();
  });
});

describe("sortSources", () => {
  const source = (id: string, available: number, date: string): DebtPaymentSource => ({
    kind: "transfer", id, roundId: "r", roundLabel: "ต.ค.", memberNumber: "11313", memberName: null,
    accountNumber: "4301008047", description: null, amount: 18000, date, available,
  });
  it("puts money with something left first, newest first within", () => {
    const sorted = sortSources([source("used", 0, "2026-10-02"), source("old", 18000, "2026-09-01"), source("new", 18000, "2026-10-01")]);
    expect(sorted.map((s) => s.id)).toEqual(["new", "old", "used"]);
  });
});
