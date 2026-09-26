import { describe, expect, it } from "vitest";
import { unbridgedRecordings, type RecordedLine } from "../lib/unbridgedRecordings";

const recorded = (over: Partial<RecordedLine> = {}): RecordedLine => ({
  expenseId: "e1",
  memberNumber: "31132",
  amount: 700,
  postedAt: new Date("2026-09-25T10:08:36Z"),
  createdAt: new Date("2026-09-25T10:09:00Z"),
  lineFingerprint: "413|2026-09-25|edu-coun|700",
  senderAccount: null,
  lineId: "l1",
  carried: 0,
  ...over,
});

describe("unbridgedRecordings", () => {
  it("surfaces a recording whose line never reached the round", () => {
    // 31132: already ✅ หักได้ครบ, so canBridgeToRound refused the ฿700 the
    // daily page had matched to their slip — the round's own transfer list
    // had nothing to show for it at all.
    const [row] = unbridgedRecordings([recorded()], []);
    expect(row).toMatchObject({
      id: "expense:e1",
      memberNumber: "31132",
      amount: 700,
      date: new Date("2026-09-25T10:08:36Z"),
    });
  });

  it("leaves out a line the round already bridged", () => {
    const bridged = {
      fingerprint: "line:413|2026-09-25|edu-coun|700",
      accountNumber: "",
      amount: 700,
      transferredAt: new Date("2026-09-25T10:08:36Z"),
    };
    expect(unbridgedRecordings([recorded()], [bridged])).toEqual([]);
  });

  it("leaves out a line the round loaded from an uploaded statement", () => {
    const uploaded = {
      fingerprint: "4130029339|700|2026-09-25T10:08",
      accountNumber: "4130029339",
      amount: 700,
      transferredAt: new Date("2026-09-25T10:08:00Z"),
    };
    expect(
      unbridgedRecordings([recorded({ senderAccount: "4130029339" })], [uploaded])
    ).toEqual([]);
  });

  it("keeps a recording whose account paid a different amount that day", () => {
    const other = {
      fingerprint: "x",
      accountNumber: "4130029339",
      amount: 500,
      transferredAt: new Date("2026-09-25T09:00:00Z"),
    };
    expect(
      unbridgedRecordings([recorded({ senderAccount: "4130029339" })], [other])
    ).toHaveLength(1);
  });

  it("falls back to when the transaction was filed if the line has no posting date", () => {
    const row = unbridgedRecordings(
      [recorded({ postedAt: null, createdAt: new Date("2026-09-26T08:00:00Z") })],
      []
    )[0];
    expect(row.date).toEqual(new Date("2026-09-26T08:00:00Z"));
  });

  it("rounds the amount to the satang", () => {
    expect(unbridgedRecordings([recorded({ amount: 700.001 })], [])[0].amount).toBe(700);
  });

  it("offers the whole line to an earlier month's debt while nothing has taken it", () => {
    const [row] = unbridgedRecordings([recorded()], []);
    expect(row).toMatchObject({ lineId: "l1", carried: 0, available: 700 });
  });

  it("says how much already pays a carried debt, and leaves only the rest", () => {
    // 31132: ✅ หักได้ครบ for September, ⚠️ ค้างข้ามเดือน ฿700 from before —
    // the ฿700 recorded on the daily page is what pays that.
    const [row] = unbridgedRecordings([recorded({ carried: 700 })], []);
    expect(row).toMatchObject({ carried: 700, available: 0 });
    const [part] = unbridgedRecordings([recorded({ carried: 200 })], []);
    expect(part.available).toBe(500);
  });

  it("keeps more than one recording for the same member apart", () => {
    const rows = unbridgedRecordings(
      [recorded({ expenseId: "e1" }), recorded({ expenseId: "e2", amount: 500 })],
      []
    );
    expect(rows.map((r) => r.id)).toEqual(["expense:e1", "expense:e2"]);
  });
});
