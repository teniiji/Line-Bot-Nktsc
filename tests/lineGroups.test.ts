import { describe, expect, it } from "vitest";
import { GROUP_JOIN_NOTICE, groupRefOf, lineTargetKind } from "../lib/lineGroups";

describe("groupRefOf", () => {
  it("reads a group chat's id", () => {
    expect(groupRefOf({ type: "group", groupId: "C1234", userId: "U9999" })).toEqual({
      id: "C1234",
      kind: "group",
    });
  });

  it("reads a multi-person room's id, which LINE names differently", () => {
    expect(groupRefOf({ type: "room", roomId: "R5678" })).toEqual({
      id: "R5678",
      kind: "room",
    });
  });

  it("returns nothing for a one-to-one chat", () => {
    // This is what keeps the agent reachable: every event the bot answers
    // has to fall through here, and every group event must not.
    expect(groupRefOf({ type: "user", userId: "U1111" })).toBeNull();
  });

  it("returns nothing when an event carries no source at all", () => {
    expect(groupRefOf(undefined)).toBeNull();
  });
});

describe("GROUP_JOIN_NOTICE", () => {
  it("tells the group the bot will not answer there", () => {
    // The point of the message: without it people post their own account
    // details into a room of colleagues expecting a private reply.
    expect(GROUP_JOIN_NOTICE).toContain("ไม่อ่านและไม่ตอบข้อความในกลุ่ม");
    expect(GROUP_JOIN_NOTICE).toContain("แชทส่วนตัว");
  });

  it("fits in one LINE message", () => {
    expect(GROUP_JOIN_NOTICE.length).toBeLessThan(2000);
  });
});

describe("lineTargetKind", () => {
  const hex = "0123456789abcdef0123456789abcdef";

  it("tells a person, a group and a room apart", () => {
    expect(lineTargetKind(`U${hex}`)).toBe("user");
    expect(lineTargetKind(`C${hex}`)).toBe("group");
    expect(lineTargetKind(`R${hex}`)).toBe("room");
  });

  it("rejects what staff actually paste by mistake", () => {
    // Each of these has turned up in a contact field at some point: a display
    // name, a half-copied id, and the unit's own name.
    expect(lineTargetKind("คุณสมชาย")).toBeNull();
    expect(lineTargetKind(`U${hex.slice(0, 20)}`)).toBeNull();
    expect(lineTargetKind("ร.ร.บ้านหนองบัว")).toBeNull();
    expect(lineTargetKind("")).toBeNull();
  });

  it("rejects an id with the right length but a letter LINE does not use", () => {
    expect(lineTargetKind(`X${hex}`)).toBeNull();
  });

  it("rejects uppercase hex, which is never what LINE issues", () => {
    expect(lineTargetKind(`U${hex.toUpperCase()}`)).toBeNull();
  });
});
