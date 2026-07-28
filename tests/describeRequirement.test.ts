import { describe, expect, it } from "vitest";
import { describeRequirement } from "../lib/agent/state";

describe("describeRequirement", () => {
  it("has a distinct Thai label for every requirement value", () => {
    const values = [
      "member_info",
      "slip",
      "category",
      "loan_type",
      "deposit_account",
      "confirm_sender_name",
      null,
    ] as const;
    const labels = values.map((v) => describeRequirement(v));
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) {
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
