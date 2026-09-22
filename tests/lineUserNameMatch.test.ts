import { describe, expect, it } from "vitest";
import { buildNameIndex, suggestMemberByName } from "../lib/lineUserNameMatch";

describe("suggestMemberByName", () => {
  it("matches a name regardless of where the spaces fall", () => {
    const index = buildNameIndex([{ memberNumber: "24621", name: "นางสุจิตรา ปู้วัง" }]);
    expect(suggestMemberByName("นาง สุจิตรา ปู้วัง", index)).toEqual({
      memberNumber: "24621",
      name: "นางสุจิตรา ปู้วัง",
    });
    expect(suggestMemberByName("นางสุจิตรา  ปู้วัง", index)).toEqual({
      memberNumber: "24621",
      name: "นางสุจิตรา ปู้วัง",
    });
  });

  it("says nothing when two different members share the same name", () => {
    // Guessing between them would be worse than the blank it started as.
    const index = buildNameIndex([
      { memberNumber: "111", name: "สมชาย ใจดี" },
      { memberNumber: "222", name: "สมชาย ใจดี" },
    ]);
    expect(suggestMemberByName("สมชาย ใจดี", index)).toBeNull();
  });

  it("says nothing for a name that matches nobody", () => {
    const index = buildNameIndex([{ memberNumber: "24621", name: "นางสุจิตรา ปู้วัง" }]);
    expect(suggestMemberByName("varaporn", index)).toBeNull();
  });

  it("says nothing when there is no name to match", () => {
    const index = buildNameIndex([{ memberNumber: "24621", name: "นางสุจิตรา ปู้วัง" }]);
    expect(suggestMemberByName(null, index)).toBeNull();
    expect(suggestMemberByName("", index)).toBeNull();
    expect(suggestMemberByName("   ", index)).toBeNull();
  });

  it("keeps one member number once, even seen across several rounds", () => {
    const index = buildNameIndex([
      { memberNumber: "24621", name: "นางสุจิตรา ปู้วัง" },
      { memberNumber: "24621", name: "นางสุจิตรา ปู้วัง" },
    ]);
    expect(suggestMemberByName("นางสุจิตรา ปู้วัง", index)).toEqual({
      memberNumber: "24621",
      name: "นางสุจิตรา ปู้วัง",
    });
  });
});
