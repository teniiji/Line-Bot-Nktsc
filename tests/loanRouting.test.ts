import { describe, expect, it, vi } from "vitest";
import { pickLoanForwardTarget } from "../lib/loanRouting";

// Real LINE ids, not readable placeholders: the picker now checks the shape,
// so a test that used "Ucode" would be testing the rejection path by accident.
const CODE = `U${"1".repeat(32)}`;
const UNIT = `U${"2".repeat(32)}`;
const ENV = `U${"3".repeat(32)}`;
const GROUP = `C${"4".repeat(32)}`;

describe("pickLoanForwardTarget", () => {
  it("prefers the responsible-code contact over everything else", () => {
    expect(
      pickLoanForwardTarget({
        responsibleContactLineUserId: CODE,
        unitContactLineUserId: UNIT,
        envFallback: ENV,
      })
    ).toBe(CODE);
  });

  it("falls back to the unit-name contact when there's no code match", () => {
    expect(
      pickLoanForwardTarget({
        responsibleContactLineUserId: null,
        unitContactLineUserId: UNIT,
        envFallback: ENV,
      })
    ).toBe(UNIT);
  });

  it("falls back to the env variable when neither matches", () => {
    expect(
      pickLoanForwardTarget({
        responsibleContactLineUserId: null,
        unitContactLineUserId: null,
        envFallback: ENV,
      })
    ).toBe(ENV);
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

  describe("a loan may never reach a group", () => {
    it("skips a group id and uses the next layer instead", () => {
      // The screens refuse a group id now, but a row saved before that check
      // existed still holds one — so the layer is skipped, not sent to.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(
        pickLoanForwardTarget({
          responsibleContactLineUserId: GROUP,
          unitContactLineUserId: UNIT,
          envFallback: ENV,
        })
      ).toBe(UNIT);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("refuses a group set in LINE_FORWARD_LOAN_ID, which no screen validates", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(
        pickLoanForwardTarget({
          responsibleContactLineUserId: null,
          unitContactLineUserId: null,
          envFallback: GROUP,
        })
      ).toBeNull();
      warn.mockRestore();
    });

    it("sends nowhere rather than to a group when every layer is one", () => {
      // Nowhere is the safe outcome: the caller logs the request as
      // unconfigured and tells the member to phone the office, which staff
      // can put right. A loan enquiry read by a room of colleagues cannot be.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(
        pickLoanForwardTarget({
          responsibleContactLineUserId: GROUP,
          unitContactLineUserId: `R${"5".repeat(32)}`,
          envFallback: GROUP,
        })
      ).toBeNull();
      warn.mockRestore();
    });

    it("skips a typo the same way, without letting it through as a target", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(
        pickLoanForwardTarget({
          responsibleContactLineUserId: "ครูสมชาย",
          unitContactLineUserId: null,
          envFallback: ENV,
        })
      ).toBe(ENV);
      warn.mockRestore();
    });

    it("tolerates a stray space around an otherwise good id", () => {
      // Copied out of a spreadsheet cell; the id itself is right, so trim it
      // rather than dropping the officer who owns the case.
      expect(
        pickLoanForwardTarget({
          responsibleContactLineUserId: ` ${CODE} `,
          unitContactLineUserId: null,
          envFallback: null,
        })
      ).toBe(CODE);
    });
  });
});
