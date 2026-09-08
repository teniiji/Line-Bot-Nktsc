import { describe, expect, it } from "vitest";
import { conversationKeyOf, groupBySource } from "../lib/eventOrdering";

const HEX = "0123456789abcdef0123456789abcdef";
const ALICE = `U${HEX}`;
const BOB = `U${"1".repeat(32)}`;
const GROUP = `C${"2".repeat(32)}`;

describe("conversationKeyOf", () => {
  it("keys a one-to-one chat by the member", () => {
    expect(conversationKeyOf({ type: "user", userId: ALICE })).toBe(`user:${ALICE}`);
  });

  it("keys a group by the group, not by whoever spoke", () => {
    // Two people posting in the same group produce events that touch the same
    // LineGroup row, so they must not overlap either.
    expect(conversationKeyOf({ type: "group", groupId: GROUP, userId: ALICE })).toBe(
      `group:${GROUP}`
    );
  });

  it("keys a room by the room", () => {
    expect(conversationKeyOf({ type: "room", roomId: "R1", userId: ALICE })).toBe("room:R1");
  });

  it("has no key for a source it cannot identify", () => {
    expect(conversationKeyOf(undefined)).toBeNull();
    expect(conversationKeyOf({})).toBeNull();
    expect(conversationKeyOf("nonsense")).toBeNull();
  });
});

describe("groupBySource", () => {
  const event = (id: string, source: unknown) => ({ id, source });
  const sourceOf = (e: { source: unknown }) => e.source;

  it("puts one member's events in a single run, in arrival order", () => {
    // The bug this exists for: a slip and the message after it, started at
    // the same moment, each writing the other's amount over its own.
    const alice = { type: "user", userId: ALICE };
    const runs = groupBySource(
      [event("slip", alice), event("text", alice)],
      sourceOf
    );

    expect(runs).toHaveLength(1);
    expect(runs[0].map((e) => e.id)).toEqual(["slip", "text"]);
  });

  it("keeps different members in separate runs so they still run in parallel", () => {
    const runs = groupBySource(
      [
        event("a1", { type: "user", userId: ALICE }),
        event("b1", { type: "user", userId: BOB }),
        event("a2", { type: "user", userId: ALICE }),
      ],
      sourceOf
    );

    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.map((e) => e.id))).toEqual([["a1", "a2"], ["b1"]]);
  });

  it("groups a group chat's events together whoever spoke", () => {
    const runs = groupBySource(
      [
        event("g1", { type: "group", groupId: GROUP, userId: ALICE }),
        event("g2", { type: "group", groupId: GROUP, userId: BOB }),
      ],
      sourceOf
    );
    expect(runs).toHaveLength(1);
    expect(runs[0].map((e) => e.id)).toEqual(["g1", "g2"]);
  });

  it("gives an unidentifiable event a run of its own", () => {
    // Nothing says what it might collide with, so it neither blocks nor is
    // blocked by anything else.
    const runs = groupBySource(
      [event("mystery", {}), event("a1", { type: "user", userId: ALICE })],
      sourceOf
    );
    expect(runs).toHaveLength(2);
    expect(runs.some((run) => run.length === 1 && run[0].id === "mystery")).toBe(true);
  });

  it("loses no events", () => {
    const input = [
      event("a1", { type: "user", userId: ALICE }),
      event("b1", { type: "user", userId: BOB }),
      event("a2", { type: "user", userId: ALICE }),
      event("mystery", undefined),
      event("g1", { type: "group", groupId: GROUP }),
    ];
    const flattened = groupBySource(input, sourceOf).flat();
    expect(flattened).toHaveLength(input.length);
    expect(new Set(flattened.map((e) => e.id))).toEqual(
      new Set(input.map((e) => e.id))
    );
  });

  it("handles a delivery with no events", () => {
    expect(groupBySource([], sourceOf)).toEqual([]);
  });
});
