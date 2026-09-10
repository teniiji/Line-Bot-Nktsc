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

  it("builds a date range that includes the whole of the last day", () => {
    // These assertions used to say lte: 2026-07-31T00:00:00Z — midnight at
    // the *start* of the last day — which is what the code did, so they
    // passed while the range dropped a day.
    const where = buildExpenseWhere(
      params({ from: "2026-07-01", to: "2026-07-31" })
    ) as { date: { gte: Date; lt: Date } };
    expect(where.date.gte).toEqual(new Date("2026-07-01T00:00:00.000Z"));
    expect(where.date.lt).toEqual(new Date("2026-08-01T00:00:00.000Z"));
  });

  it("finds a transaction logged during the last day of the range", () => {
    // The whole bug, as a question about one payment: ฿200,000 at 10:31 on
    // the last day of the range.
    const { date } = buildExpenseWhere(params({ from: "2026-09-01", to: "2026-09-10" })) as {
      date: { gte: Date; lt: Date };
    };
    const logged = new Date("2026-09-10T10:31:00.000Z");
    expect(logged >= date.gte && logged < date.lt).toBe(true);
  });

  it("finds today's transactions when both ends are today", () => {
    // "วันนี้" matched nothing at all: from and to were the same instant, so
    // only a payment logged at exactly midnight could fall inside.
    const { date } = buildExpenseWhere(params({ from: "2026-09-10", to: "2026-09-10" })) as {
      date: { gte: Date; lt: Date };
    };
    for (const at of ["00:00:00", "03:31:00", "10:31:00", "23:59:59"]) {
      const logged = new Date(`2026-09-10T${at}.000Z`);
      expect(logged >= date.gte && logged < date.lt, at).toBe(true);
    }
  });

  it("stops at the end of the last day, not into the next one", () => {
    const { date } = buildExpenseWhere(params({ from: "2026-09-10", to: "2026-09-10" })) as {
      date: { gte: Date; lt: Date };
    };
    expect(new Date("2026-09-11T00:00:00.000Z") < date.lt).toBe(false);
    expect(new Date("2026-09-09T23:59:59.000Z") >= date.gte).toBe(false);
  });

  it("supports open-ended date ranges", () => {
    const fromOnly = buildExpenseWhere(params({ from: "2026-07-01" })) as {
      date: Record<string, Date>;
    };
    expect(fromOnly.date.gte).toEqual(new Date("2026-07-01T00:00:00.000Z"));
    expect(fromOnly.date.lt).toBeUndefined();

    const toOnly = buildExpenseWhere(params({ to: "2026-07-31" })) as {
      date: Record<string, Date>;
    };
    expect(toOnly.date.lt).toEqual(new Date("2026-08-01T00:00:00.000Z"));
    expect(toOnly.date.gte).toBeUndefined();
  });

  it("drops a date it cannot read rather than failing the request", () => {
    // An Invalid Date reaches Prisma as an error, and the answer to a
    // mistyped date is a wider list, not an error page.
    expect(buildExpenseWhere(params({ from: "not-a-date" }))).toEqual({});
    const { date } = buildExpenseWhere(params({ from: "2026-07-01", to: "31/07/2026" })) as {
      date: Record<string, Date>;
    };
    expect(date.gte).toEqual(new Date("2026-07-01T00:00:00.000Z"));
    expect(date.lt).toBeUndefined();
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
