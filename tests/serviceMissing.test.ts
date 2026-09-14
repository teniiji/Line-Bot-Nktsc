import { describe, expect, it } from "vitest";
import { computeServiceMissing, describeServiceMissing } from "../lib/agent/state";
import type { LineUserInfo, PendingServiceInfo } from "../lib/agent/types";

const request = (over: Partial<PendingServiceInfo> = {}): PendingServiceInfo => ({
  documentType: "สลิปเงินเดือน",
  requestType: null,
  department: null,
  imageUrl: null,
  imageIsPdf: false,
  ...over,
});

const user = (over: Partial<LineUserInfo> = {}): LineUserInfo => ({
  fullName: null,
  memberNumber: null,
  verified: false,
  phone: null,
  ...over,
});

describe("computeServiceMissing", () => {
  it("names everything outstanding at once, not the next one thing", () => {
    // She sent a salary certificate and was asked what she wanted, then who
    // she was, then her member number, then her telephone number — four
    // rounds, each waiting on the one before, for answers that depend on
    // nothing.
    expect(computeServiceMissing(user(), request())).toEqual([
      "purpose",
      "member_info",
      "phone",
    ]);
  });

  it("leaves out what is already on record", () => {
    const known = user({ fullName: "นางสาวธัญญริญญ์ กุลธรศุภสวัสดิ์", memberNumber: "31538" });
    expect(computeServiceMissing(known, request({ requestType: "ขอกู้เงิน" }))).toEqual(["phone"]);
  });

  it("is empty once the request can be forwarded", () => {
    const complete = user({ fullName: "ก", memberNumber: "31538", phone: "0922565244" });
    expect(computeServiceMissing(complete, request({ requestType: "ขอกู้เงิน" }))).toEqual([]);
  });

  it("still counts half an identity as missing", () => {
    // A name without a number cannot be forwarded any more than neither can.
    const half = user({ fullName: "ก" });
    expect(computeServiceMissing(half, request({ requestType: "ขอกู้เงิน" }))).toContain(
      "member_info"
    );
  });

  it("agrees with the one-at-a-time ladder about what comes first", () => {
    // The old function still decides ordering elsewhere; the two must not
    // disagree about what is outstanding.
    expect(computeServiceMissing(user(), request())[0]).toBe("purpose");
  });
});

describe("describeServiceMissing", () => {
  it("asks for both halves of an identity when neither is known", () => {
    const labels = describeServiceMissing(["member_info"], user());
    expect(labels).toEqual(["ชื่อ-นามสกุล และเลขสมาชิก"]);
  });

  it("asks only for the half that is missing", () => {
    // Asking again for a name already given is what made the conversation
    // feel like an interrogation.
    expect(describeServiceMissing(["member_info"], user({ fullName: "ก" }))).toEqual([
      "เลขสมาชิก",
    ]);
    expect(describeServiceMissing(["member_info"], user({ memberNumber: "31538" }))).toEqual([
      "ชื่อ-นามสกุล",
    ]);
  });

  it("names all three in the order they are asked", () => {
    expect(describeServiceMissing(["purpose", "member_info", "phone"], user())).toEqual([
      "ต้องการทำรายการอะไร",
      "ชื่อ-นามสกุล และเลขสมาชิก",
      "เบอร์โทรติดต่อกลับ",
    ]);
  });

  it("says nothing when nothing is missing", () => {
    expect(describeServiceMissing([], user())).toEqual([]);
  });
});
