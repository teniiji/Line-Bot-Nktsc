import { describe, expect, it } from "vitest";
import { resolveLineUserIdentity } from "../lib/lineUserIdentity";

const roster = (over = {}) => ({
  memberNumber: "31744",
  memberName: "นางสาวทดสอบ ใจดี",
  phone: "0812345678",
  lineUserId: null as string | null,
  ...over,
});
const user = (over = {}) => ({ id: "U1", fullName: null, memberNumber: null, phone: null, ...over });

describe("who a LINE account is", () => {
  it("is the register row bound to it, with the register's phone", () => {
    expect(resolveLineUserIdentity({ bound: roster({ lineUserId: "U1" }), user: user(), byNumber: null })).toEqual({
      fullName: "นางสาวทดสอบ ใจดี",
      memberNumber: "31744",
      verified: true,
      phone: "0812345678",
    });
  });

  it("prefers the phone the member gave", () => {
    const id = resolveLineUserIdentity({ bound: roster({ lineUserId: "U1" }), user: user({ phone: "0899999999" }), byNumber: null });
    expect(id?.phone).toBe("0899999999");
  });

  it("takes the name from the register for a member number set on the account", () => {
    // Staff set 31744 on สมาชิก LINE; the account had no name of its own.
    const id = resolveLineUserIdentity({ bound: null, user: user({ memberNumber: "31744" }), byNumber: roster() });
    expect(id).toEqual({ fullName: "นางสาวทดสอบ ใจดี", memberNumber: "31744", verified: false, phone: "0812345678" });
  });

  it("does not borrow a register row that belongs to another LINE account", () => {
    const id = resolveLineUserIdentity({
      bound: null,
      user: user({ memberNumber: "31744" }),
      byNumber: roster({ lineUserId: "U2" }),
    });
    expect(id?.fullName).toBeNull();
    expect(id?.phone).toBeNull();
  });

  it("keeps what the member typed when there is nothing better", () => {
    const id = resolveLineUserIdentity({
      bound: null,
      user: user({ fullName: "สมชาย", memberNumber: "99999" }),
      byNumber: null,
    });
    expect(id).toEqual({ fullName: "สมชาย", memberNumber: "99999", verified: false, phone: null });
    expect(resolveLineUserIdentity({ bound: null, user: null, byNumber: null })).toBeNull();
  });
});
