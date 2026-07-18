import { describe, expect, it } from "vitest";
import { pickDepartmentForwardTargets } from "../lib/departmentRouting";

describe("pickDepartmentForwardTargets", () => {
  it("broadcasts to every assigned officer when the department has any", () => {
    expect(
      pickDepartmentForwardTargets({
        contactLineUserIds: ["Uofficer1", "Uofficer2"],
        envFallback: "Uenv",
      })
    ).toEqual(["Uofficer1", "Uofficer2"]);
  });

  it("falls back to the env variable when the department has no officers", () => {
    expect(
      pickDepartmentForwardTargets({
        contactLineUserIds: [],
        envFallback: "Uenv",
      })
    ).toEqual(["Uenv"]);
  });

  it("returns an empty list when nothing is configured at all", () => {
    expect(
      pickDepartmentForwardTargets({
        contactLineUserIds: [],
        envFallback: null,
      })
    ).toEqual([]);
  });
});
