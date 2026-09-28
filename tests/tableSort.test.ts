import { describe, expect, it } from "vitest";
import { sortRows } from "../lib/tableSort";

describe("sortRows", () => {
  it("sorts member numbers as numbers, both ways", () => {
    const rows = ["29457", "3001", "28564"];
    expect(sortRows(rows, (r) => r, "asc")).toEqual(["3001", "28564", "29457"]);
    expect(sortRows(rows, (r) => r, "desc")).toEqual(["29457", "28564", "3001"]);
  });

  it("sorts Thai text in Thai order, with trailing numbers in number order", () => {
    const rows = ["อุดรธานี 10", "ขอนแก่น 1", "อุดรธานี 2"];
    expect(sortRows(rows, (r) => r, "asc")).toEqual(["ขอนแก่น 1", "อุดรธานี 2", "อุดรธานี 10"]);
  });

  it("keeps blanks last whichever way the column is turned", () => {
    const rows = [{ v: null }, { v: "ต.2" }, { v: "" }, { v: "ต.1" }];
    expect(sortRows(rows, (r) => r.v, "asc").map((r) => r.v)).toEqual(["ต.1", "ต.2", null, ""]);
    expect(sortRows(rows, (r) => r.v, "desc").map((r) => r.v)).toEqual(["ต.2", "ต.1", null, ""]);
  });
});
