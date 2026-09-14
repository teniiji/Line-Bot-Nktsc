import { describe, expect, it } from "vitest";
import {
  compareSlipAccount,
  normalizeAccountPattern,
  parseSlipTime,
  slipTimeMinutes,
} from "../lib/slipDetails";

describe("parseSlipTime", () => {
  it("reads the shapes Thai banking apps actually print", () => {
    expect(parseSlipTime("09:07")).toBe("09:07");
    expect(parseSlipTime("9:07 น.")).toBe("09:07");
    expect(parseSlipTime("09:07:46")).toBe("09:07");
    expect(parseSlipTime("๐๙:๐๗")).toBe("09:07");
    expect(parseSlipTime("17 ส.ค. 2569 14:32 น.")).toBe("14:32");
  });

  it("accepts a dot as the separator, which some apps use", () => {
    expect(parseSlipTime("14.32")).toBe("14:32");
  });

  it("drops the seconds rather than keeping a precision nothing else has", () => {
    // The bank's own clock and the app's never agree to the second, and the
    // reconciliation only ever asks which minute is closest.
    expect(parseSlipTime("14:32:07")).toBe("14:32");
  });

  it("refuses a clock that cannot exist instead of clamping it", () => {
    // A misread time is worse than no time: it would rank a pairing
    // confidently in the wrong direction.
    expect(parseSlipTime("25:00")).toBeNull();
    expect(parseSlipTime("12:70")).toBeNull();
  });

  it("returns nothing when the slip shows no time at all", () => {
    expect(parseSlipTime("ไม่ระบุ")).toBeNull();
    expect(parseSlipTime("")).toBeNull();
    expect(parseSlipTime(undefined)).toBeNull();
    expect(parseSlipTime(1407)).toBeNull();
  });
});

describe("slipTimeMinutes", () => {
  it("counts from midnight so two clocks can be compared", () => {
    expect(slipTimeMinutes("00:00")).toBe(0);
    expect(slipTimeMinutes("09:07")).toBe(547);
    expect(slipTimeMinutes("23:59")).toBe(1439);
  });

  it("has nothing to say about a slip with no time", () => {
    expect(slipTimeMinutes(null)).toBeNull();
  });
});

describe("normalizeAccountPattern", () => {
  it("keeps the digits the bank left visible and marks the rest", () => {
    expect(normalizeAccountPattern("xxx-x-x2885-6")).toBe("xxxxx28856");
    expect(normalizeAccountPattern("413-1-57288-5")).toBe("4131572885");
  });

  it("treats every masking character an app might use the same way", () => {
    expect(normalizeAccountPattern("XXX-X-X2885-6")).toBe("xxxxx28856");
    expect(normalizeAccountPattern("•••-•-•2885-6")).toBe("xxxxx28856");
  });

  it("reads Thai numerals, which some slips print", () => {
    expect(normalizeAccountPattern("xxx-x-x๒๘๘๕-๖")).toBe("xxxxx28856");
  });

  it("refuses a pattern that shows too little to tell payers apart", () => {
    // Three visible digits is one payer in a thousand — on a busy day that
    // is a coincidence, not a match.
    expect(normalizeAccountPattern("xxx-x-xxx88-5")).toBeNull();
  });

  it("refuses something that is not an account number at all", () => {
    expect(normalizeAccountPattern("ธนาคารกรุงไทย")).toBeNull();
    expect(normalizeAccountPattern("ไม่ระบุ")).toBeNull();
    expect(normalizeAccountPattern("KTB 2885")).toBeNull();
    expect(normalizeAccountPattern("")).toBeNull();
    expect(normalizeAccountPattern(undefined)).toBeNull();
  });

  it("refuses a fragment too short to be an account", () => {
    expect(normalizeAccountPattern("2885")).toBeNull();
  });
});

describe("compareSlipAccount", () => {
  // The statement's own form: ten digits, no separators (see
  // extractSenderAccount in lib/statementLines.ts).
  const statement = "4131572885";

  it("matches the masked form of that same account", () => {
    // 4131572885 printed as 413-1-57288-5; the app hides all but the tail.
    expect(compareSlipAccount("xxx-x-x7288-5", statement)).toBe("match");
    expect(compareSlipAccount("413-1-57288-5", statement)).toBe("match");
  });

  it("matches a shorter pattern too, aligned from the right", () => {
    expect(compareSlipAccount("xxx-2885", statement)).toBe("match");
  });

  it("says two accounts are different when the visible digits disagree", () => {
    // Same length, so the right-alignment is not an assumption — these are
    // two different accounts and the pair must not be made.
    expect(compareSlipAccount("xxx-x-x1234-5", statement)).toBe("conflict");
  });

  it("will not call a disagreement a conflict when the lengths differ", () => {
    // One of the two may carry a prefix the other doesn't, so the alignment
    // itself is a guess — and a wrong guess must never refuse a real pairing.
    expect(compareSlipAccount("xxxx-1234", statement)).toBe("unknown");
  });

  it("has nothing to say when either side is missing", () => {
    expect(compareSlipAccount(null, statement)).toBe("unknown");
    expect(compareSlipAccount("xxx-2885", null)).toBe("unknown");
    expect(compareSlipAccount("ไม่ระบุ", statement)).toBe("unknown");
  });

  it("has nothing to say when the statement named no account", () => {
    // Plenty of statement lines don't — a counter deposit, a wallet transfer.
    expect(compareSlipAccount("xxx-2885", "")).toBe("unknown");
    expect(compareSlipAccount("xxx-2885", "TR from EWALLETID")).toBe("unknown");
  });
});
