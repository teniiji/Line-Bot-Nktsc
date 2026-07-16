import { describe, expect, it } from "vitest";
import { buildExpenseWhere } from "../lib/expenseFilters";

const params = (init: Record<string, string>) => new URLSearchParams(init);

describe("buildExpenseWhere", () => {
  it("returns an empty filter for no params", () => {
    expect(buildExpenseWhere(params({}))).toEqual({});
  });

  it("filters by category, but treats 'All' as no filter", () => {
    expect(buildExpenseWhere(params({ category: "ชำระหนี้" }))).toEqual({
      category: "ชำระหนี้",
    });
    expect(buildExpenseWhere(params({ category: "All" }))).toEqual({});
  });

  it("filters the verification review queue", () => {
    expect(buildExpenseWhere(params({ verified: "false" }))).toEqual({
      memberVerified: false,
    });
    expect(buildExpenseWhere(params({ verified: "true" }))).toEqual({
      memberVerified: true,
    });
    // Anything else means "no verification filter"
    expect(buildExpenseWhere(params({ verified: "" }))).toEqual({});
    expect(buildExpenseWhere(params({ verified: "yes" }))).toEqual({});
  });

  it("builds a date range from from/to", () => {
    const where = buildExpenseWhere(
      params({ from: "2026-07-01", to: "2026-07-31" })
    ) as { date: { gte: Date; lte: Date } };
    expect(where.date.gte).toEqual(new Date("2026-07-01"));
    expect(where.date.lte).toEqual(new Date("2026-07-31"));
  });

  it("supports open-ended date ranges", () => {
    const fromOnly = buildExpenseWhere(params({ from: "2026-07-01" })) as {
      date: Record<string, Date>;
    };
    expect(fromOnly.date.gte).toEqual(new Date("2026-07-01"));
    expect(fromOnly.date.lte).toBeUndefined();
  });

  it("combines all filters", () => {
    const where = buildExpenseWhere(
      params({
        category: "ฝากเงิน",
        verified: "false",
        lineUserId: "U123",
        from: "2026-01-01",
      })
    );
    expect(where).toMatchObject({
      category: "ฝากเงิน",
      memberVerified: false,
      lineUserId: "U123",
    });
  });
});
