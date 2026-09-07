import { describe, expect, it } from "vitest";
import { pickDepartmentForwardTargets, planDepartmentForward } from "../lib/departmentRouting";

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

describe("planDepartmentForward", () => {
  const hex = (n: string) => n.repeat(32).slice(0, 32);
  const person = `U${hex("a")}`;
  const person2 = `U${hex("b")}`;
  const group = `C${hex("c")}`;
  const room = `R${hex("d")}`;
  const env = `U${hex("e")}`;

  it("keeps broadcasting to every officer when no group is assigned", () => {
    expect(
      planDepartmentForward({ contactLineUserIds: [person, person2], envFallback: env })
    ).toEqual({ primary: [person, person2], fallback: [], viaGroup: false });
  });

  it("sends to the group and keeps the officers behind it", () => {
    // A group cannot report that the bot was removed from it until a push is
    // attempted, so the people it replaced stay reachable.
    expect(
      planDepartmentForward({ contactLineUserIds: [person, group], envFallback: env })
    ).toEqual({ primary: [group], fallback: [person], viaGroup: true });
  });

  it("treats a multi-person room as a group", () => {
    const plan = planDepartmentForward({ contactLineUserIds: [room, person], envFallback: env });
    expect(plan.primary).toEqual([room]);
    expect(plan.viaGroup).toBe(true);
  });

  it("falls back to the catch-all when the group is all the department has", () => {
    expect(planDepartmentForward({ contactLineUserIds: [group], envFallback: env })).toEqual({
      primary: [group],
      fallback: [env],
      viaGroup: true,
    });
  });

  it("leaves a group-only department with no fallback when there is no catch-all", () => {
    expect(planDepartmentForward({ contactLineUserIds: [group], envFallback: null })).toEqual({
      primary: [group],
      fallback: [],
      viaGroup: true,
    });
  });

  it("does not fall back when a named officer's push fails", () => {
    // Rerouting a member's request to the catch-all because one officer's
    // account is stale would send it to somebody who is not handling it.
    const plan = planDepartmentForward({ contactLineUserIds: [person], envFallback: env });
    expect(plan.fallback).toEqual([]);
  });

  it("still reaches the catch-all for a department with nobody assigned", () => {
    expect(planDepartmentForward({ contactLineUserIds: [], envFallback: env })).toEqual({
      primary: [env],
      fallback: [],
      viaGroup: false,
    });
  });

  it("sends to every group when a department has more than one", () => {
    const group2 = `C${hex("f")}`;
    const plan = planDepartmentForward({
      contactLineUserIds: [group, group2, person],
      envFallback: env,
    });
    expect(plan.primary).toEqual([group, group2]);
    expect(plan.fallback).toEqual([person]);
  });
});
