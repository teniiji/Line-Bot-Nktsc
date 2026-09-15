import { describe, expect, it } from "vitest";
import { MIXUP_SHARE, mixedUpWith, mixupError } from "../lib/statementAccountMixup";
import { parseStatementLines, statementLineIdentity } from "../lib/statementLines";

const overlap = (account: string, lines: number) => ({
  account,
  branch: account === "413" ? "หนองคาย" : "บึงกาฬ",
  lines,
});

describe("mixedUpWith", () => {
  it("catches a whole file that is already under the other account", () => {
    // What picking the wrong account out of the dropdown looks like: every
    // line of the file is already stored, just not where it was sent.
    expect(mixedUpWith(1186, [overlap("413", 1186)])).toMatchObject({ account: "413" });
  });

  it("says nothing about a file nothing has seen", () => {
    // The ordinary case, and the one that must never be blocked.
    expect(mixedUpWith(1186, [])).toBeNull();
    expect(mixedUpWith(1186, [overlap("413", 0)])).toBeNull();
  });

  it("does not block a file over a handful of shared lines", () => {
    // A correct upload overlaps another account by nothing; the wrong one
    // overlaps by everything. The threshold is there so nothing in between
    // can stop a statement loading.
    expect(mixedUpWith(1186, [overlap("413", 3)])).toBeNull();
  });

  it("names the account with the most of the file in it", () => {
    const worst = mixedUpWith(100, [overlap("413", 90), overlap("447", 60)]);
    expect(worst?.account).toBe("413");
  });

  it("holds the line exactly where it says it does", () => {
    expect(mixedUpWith(100, [overlap("413", Math.ceil(100 * MIXUP_SHARE))])).not.toBeNull();
    expect(mixedUpWith(100, [overlap("413", Math.floor(100 * MIXUP_SHARE) - 1)])).toBeNull();
  });

  it("says nothing about an empty file", () => {
    expect(mixedUpWith(0, [overlap("413", 0)])).toBeNull();
  });
});

describe("mixupError", () => {
  it("names both accounts, since the fix is to pick the other one", () => {
    const message = mixupError(
      { account: "447", branch: "บึงกาฬ" },
      overlap("413", 1186),
      1186
    );
    expect(message).toContain("413");
    expect(message).toContain("447");
    expect(message).toContain("หนองคาย");
  });

  it("says what to do about the copy already stored", () => {
    // The upload that caused this was very likely the one before this, so the
    // refusal is also the moment to say where the mess is cleaned up.
    expect(mixupError({ account: "447", branch: "บึงกาฬ" }, overlap("413", 10), 10)).toContain(
      "ลบไฟล์ที่อัปผิด"
    );
  });
});

describe("statementLineIdentity", () => {
  const rows: unknown[][] = [
    ["03/08/2026 09:17:22", "", "IORSDT", "004-0583774459", "", "3100.00", "", "1000000.00", ""],
    ["03/08/2026 09:20:00", "", "NBSDT", "TR fr 4131572885", "", "500.00", "", "1000500.00", ""],
  ];

  it("is the same for the same file whatever account it is filed under", () => {
    // The property the check rests on. The account is added afterwards, in
    // statementLineFingerprint, which is what makes the same file under two
    // accounts two sets of rows in the first place.
    const lines = parseStatementLines(rows);
    expect(lines.map(statementLineIdentity)).toEqual(
      parseStatementLines(rows).map(statementLineIdentity)
    );
  });

  it("carries the running balance, which is what makes it an identity", () => {
    // Two accounts cannot post the same amount at the same second and reach
    // the same balance, so a shared identity is the same line, not a
    // coincidence.
    const [line] = parseStatementLines(rows);
    const other = parseStatementLines([
      ["03/08/2026 09:17:22", "", "IORSDT", "004-0583774459", "", "3100.00", "", "9999999.00", ""],
    ]);
    expect(statementLineIdentity(line)).not.toBe(statementLineIdentity(other[0]));
  });

  it("tells two identical lines in one file apart", () => {
    const twice = parseStatementLines([rows[0], rows[0]]);
    expect(statementLineIdentity(twice[0])).not.toBe(statementLineIdentity(twice[1]));
  });
});
