import { describe, expect, it } from "vitest";
import { likelyDuplicates, type SlipLike } from "../lib/slipDuplicates";

const slip = (over: Partial<SlipLike>): SlipLike => ({
  id: "s",
  amount: 30000,
  date: new Date("2026-10-12T00:00:00Z"),
  memberNumber: "900539",
  category: "ซื้อหุ้น",
  ...over,
});
const posted = new Date("2026-10-12T09:46:54Z");

describe("likelyDuplicates", () => {
  it("flags a spare beside the slip that already paired (900539)", () => {
    const hints = likelyDuplicates([slip({ id: "typed" })], [{ slip: slip({ id: "sent" }), postedAt: posted }]);
    expect(hints.get("typed")).toEqual({ ofSlipId: "sent", matched: true, postedAt: posted });
  });

  it("reads member numbers as members, and a blank category as agreeing", () => {
    const hints = likelyDuplicates(
      [slip({ id: "typed", memberNumber: "0900539", category: null })],
      [{ slip: slip({ id: "sent" }), postedAt: posted }]
    );
    expect(hints.has("typed")).toBe(true);
  });

  it("does not flag a different member, amount, day or purpose", () => {
    const paired = [{ slip: slip({ id: "sent" }), postedAt: posted }];
    for (const other of [
      { memberNumber: "900540" },
      { amount: 3000 },
      { date: new Date("2026-10-13T00:00:00Z") },
      { category: "ฝากเงิน" },
      { memberNumber: null },
    ]) {
      expect(likelyDuplicates([slip({ id: "x", ...other })], paired).size).toBe(0);
    }
  });

  it("lets one paired slip explain only one spare", () => {
    const hints = likelyDuplicates(
      [slip({ id: "a" }), slip({ id: "b" })],
      [{ slip: slip({ id: "sent" }), postedAt: posted }]
    );
    expect(hints.get("a")?.matched).toBe(true);
    // The second spare repeats the first spare, not the paired one.
    expect(hints.get("b")).toEqual({ ofSlipId: "a", matched: false, postedAt: null });
  });

  it("flags the later of two waiting copies and keeps the first", () => {
    const hints = likelyDuplicates(
      [slip({ id: "late", date: new Date("2026-10-12T08:00:00Z") }), slip({ id: "early" })],
      []
    );
    expect(hints.has("early")).toBe(false);
    expect(hints.get("late")).toEqual({ ofSlipId: "early", matched: false, postedAt: null });
  });
});
