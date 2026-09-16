import { describe, expect, it } from "vitest";
import { ownersFromRecordings, type RecordedPayment } from "../lib/recordedOwners";

const payment = (over: Partial<RecordedPayment> = {}): RecordedPayment => ({
  accountNumber: "6790899405",
  memberNumber: "29819",
  memberName: "นางสาวสยุบภู บุญโสม",
  category: "ชำระเก็บไม่ได้รายเดือน",
  recordedAt: new Date("2026-09-01T10:00:00.000Z"),
  ...over,
});

describe("ownersFromRecordings", () => {
  it("surfaces what the daily page was told about an account", () => {
    // ฿6,690 reading "ตรงกับสลิป · 29819 · ชำระเก็บไม่ได้รายเดือน" on one tab
    // and "โอนเข้ามาแต่ไม่พบเจ้าของ" on the other. The work was done; the
    // round had no way to hear about it.
    const owners = ownersFromRecordings([payment()]);
    expect(owners.get("6790899405")).toMatchObject({
      memberNumber: "29819",
      category: "ชำระเก็บไม่ได้รายเดือน",
    });
  });

  it("takes the most recent answer for an account", () => {
    // Recording again is how a wrong guess is corrected, so the last word
    // wins rather than whichever row the database returned first.
    const owners = ownersFromRecordings([
      payment({ memberNumber: "11111", recordedAt: new Date("2026-08-01T00:00:00.000Z") }),
      payment({ memberNumber: "29819", recordedAt: new Date("2026-09-01T00:00:00.000Z") }),
    ]);
    expect(owners.get("6790899405")?.memberNumber).toBe("29819");
  });

  it("is not fooled by the order rows arrive in", () => {
    const owners = ownersFromRecordings([
      payment({ memberNumber: "29819", recordedAt: new Date("2026-09-01T00:00:00.000Z") }),
      payment({ memberNumber: "11111", recordedAt: new Date("2026-08-01T00:00:00.000Z") }),
    ]);
    expect(owners.get("6790899405")?.memberNumber).toBe("29819");
  });

  it("keeps accounts apart", () => {
    const owners = ownersFromRecordings([
      payment(),
      payment({ accountNumber: "4130140299", memberNumber: "30992" }),
    ]);
    expect(owners.get("6790899405")?.memberNumber).toBe("29819");
    expect(owners.get("4130140299")?.memberNumber).toBe("30992");
  });

  it("offers nothing for a recording that names no member", () => {
    // An empty member number is not an answer, and offering it as one would
    // put "" in the box for somebody to save.
    expect(ownersFromRecordings([payment({ memberNumber: "" })]).size).toBe(0);
  });

  it("says nothing when nothing has been recorded", () => {
    expect(ownersFromRecordings([]).size).toBe(0);
  });
});
