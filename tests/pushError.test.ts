import { describe, expect, it } from "vitest";
import { describePushError, summarisePushFailures } from "../lib/pushError";

// Two forwards failed on 11 Sep and the dashboard said only "ส่งต่อไม่สำเร็จ"
// for both. Each cause below needs a different person to do a different
// thing, and the status code already says which.

describe("describePushError", () => {
  it("names the quota, which is what fails every push at once", () => {
    // Two unrelated forwards failing the same day, while every reply to a
    // member still works, is what this looks like from outside: replies are
    // free and unmetered, pushes are not.
    const { reason, status } = describePushError({ status: 429, body: "monthly limit" });
    expect(status).toBe(429);
    expect(reason).toContain("โควตา");
    expect(reason).toContain("monthly limit");
  });

  it("names the officer who never added the OA", () => {
    expect(describePushError({ status: 403 }).reason).toContain("ยังไม่ได้เพิ่ม LINE OA");
  });

  it("names a wrong user id", () => {
    expect(describePushError({ status: 400 }).reason).toContain("LINE UserID");
  });

  it("names an expired token", () => {
    expect(describePushError({ status: 401 }).reason).toContain("token");
  });

  it("calls a 5xx what it is — theirs, and worth retrying", () => {
    expect(describePushError({ status: 503 }).reason).toContain("ขัดข้องชั่วคราว");
  });

  it("reads the status from an older wrapped SDK error", () => {
    expect(describePushError({ originalError: { response: { status: 403 } } }).status).toBe(403);
  });

  it("reads a message out of a JSON body as well as a string one", () => {
    expect(describePushError({ status: 400, body: { message: "Invalid to" } }).reason).toContain(
      "Invalid to"
    );
  });

  it("says something useful when there is no status at all", () => {
    // A DNS failure or a timeout never reaches LINE and has no status.
    expect(describePushError(new Error("fetch failed")).reason).toContain("fetch failed");
  });

  it("never throws, whatever it is handed", () => {
    // A failure to describe a failure must not become a second failure.
    for (const value of [null, undefined, "", 0, [], {}]) {
      expect(() => describePushError(value)).not.toThrow();
    }
  });
});

describe("summarisePushFailures", () => {
  it("says nothing when nothing failed", () => {
    expect(summarisePushFailures([])).toBeNull();
  });

  it("reports one failure as itself", () => {
    expect(summarisePushFailures([{ status: 403 }])).toContain("ยังไม่ได้เพิ่ม");
  });

  it("counts several and does not repeat one cause three times", () => {
    const out = summarisePushFailures([{ status: 403 }, { status: 403 }, { status: 429 }]);
    expect(out).toContain("ล้มเหลว 3 ปลายทาง");
    expect(out!.match(/ยังไม่ได้เพิ่ม/g)).toHaveLength(1);
    expect(out).toContain("โควตา");
  });

  it("stays short enough for a table cell", () => {
    const long = summarisePushFailures([{ status: 400, body: "x".repeat(2000) }]);
    expect(long!.length).toBeLessThanOrEqual(300);
  });
});
