import { describe, expect, it } from "vitest";
import { agreedBindings } from "../lib/bulkBinding";

const pair = (accountNumber: string, memberNumber: string) => ({ accountNumber, memberNumber });

describe("agreedBindings", () => {
  it("writes the bindings the database still agrees with", () => {
    const { apply, stale } = agreedBindings(
      [pair("6790899405", "29819"), pair("4130140299", "30992")],
      new Map([
        ["6790899405", "29819"],
        ["4130140299", "30992"],
      ])
    );
    expect(apply).toHaveLength(2);
    expect(stale).toHaveLength(0);
  });

  it("refuses one the database no longer says", () => {
    // Somebody recorded a different member between the page being drawn and
    // the button being pressed. The person approved the old answer; writing
    // the new one would bind an account they never saw named.
    const { apply, stale } = agreedBindings(
      [pair("6790899405", "29819")],
      new Map([["6790899405", "30993"]])
    );
    expect(apply).toHaveLength(0);
    expect(stale).toEqual([pair("6790899405", "29819")]);
  });

  it("refuses one the database no longer has at all", () => {
    const { apply, stale } = agreedBindings([pair("6790899405", "29819")], new Map());
    expect(apply).toHaveLength(0);
    expect(stale).toHaveLength(1);
  });

  it("counts an account once however many rows it had", () => {
    // A member who paid in three times is three rows on screen and one
    // binding — otherwise the answer reads "ผูกให้ 12 บัญชี" for four.
    const { apply } = agreedBindings(
      [pair("6790899405", "29819"), pair("6790899405", "29819"), pair("6790899405", "29819")],
      new Map([["6790899405", "29819"]])
    );
    expect(apply).toEqual([pair("6790899405", "29819")]);
  });

  it("keeps the good ones when one of the batch has gone stale", () => {
    const { apply, stale } = agreedBindings(
      [pair("1", "11"), pair("2", "22"), pair("3", "33")],
      new Map([
        ["1", "11"],
        ["2", "99"],
        ["3", "33"],
      ])
    );
    expect(apply.map((p) => p.accountNumber)).toEqual(["1", "3"]);
    expect(stale.map((p) => p.accountNumber)).toEqual(["2"]);
  });

  it("writes nothing when nothing was proposed", () => {
    const { apply, stale } = agreedBindings([], new Map([["6790899405", "29819"]]));
    expect(apply).toHaveLength(0);
    expect(stale).toHaveLength(0);
  });
});
