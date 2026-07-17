import { describe, expect, it } from "vitest";
import { pickLoanForwardTarget } from "../lib/loanRouting";

describe("pickLoanForwardTarget", () => {
  it("prefers the responsible-code contact over everything else", () => {
    expect(
      pickLoanForwardTarget({
        responsibleContactLineUserId: "Ucode",
        unitContactLineUserId: "Uunit",
        envFallback: "Uenv",
      })
    ).toBe("Ucode");
  });

  it("falls back to the unit-name contact when there's no code match", () => {
    expect(
      pickLoanForwardTarget({
        responsibleContactLineUserId: null,
        unitContactLineUserId: "Uunit",
        envFallback: "Uenv",
      })
    ).toBe("Uunit");
  });

  it("falls back to the env variable when neither matches", () => {
    expect(
      pickLoanForwardTarget({
        responsibleContactLineUserId: null,
        unitContactLineUserId: null,
        envFallback: "Uenv",
      })
    ).toBe("Uenv");
  });

  it("returns null when nothing is configured at all", () => {
    expect(
      pickLoanForwardTarget({
        responsibleContactLineUserId: null,
        unitContactLineUserId: null,
        envFallback: null,
      })
    ).toBeNull();
  });
});
