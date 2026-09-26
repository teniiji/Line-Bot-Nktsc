import { describe, expect, it } from "vitest";
import { isStandIn, pairStandIns } from "../lib/bridgeDedupe";

const at = (iso: string) => new Date(iso);
const bridge = (over = {}) => ({
  fingerprint: "line:abc",
  accountNumber: "9700007561",
  amount: 6000,
  transferredAt: at("2026-09-26T02:43:00Z"),
  memberNumber: "29746",
  ...over,
});
const upload = (over = {}) => ({
  fingerprint: "4130000000|2026-09-26|9700007561|6000",
  accountNumber: "9700007561",
  amount: 6000,
  transferredAt: at("2026-09-26T02:43:10Z"),
  memberNumber: "29746",
  manualMemberNumber: false,
  ...over,
});

describe("pairStandIns", () => {
  it("pairs a daily-page stand-in with the file's copy of the same line", () => {
    // 29746: ฿6,000 on 26 ก.ย. put on them from the daily page, then the
    // statement uploaded into the round — counted twice, ชำระเกิน ฿6,000.
    const pairs = pairStandIns([bridge()], [upload()]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].real.fingerprint).toBe(upload().fingerprint);
  });

  it("leaves a different amount, account or day alone", () => {
    expect(pairStandIns([bridge()], [upload({ amount: 5000 })])).toHaveLength(0);
    expect(pairStandIns([bridge()], [upload({ accountNumber: "1111111111" })])).toHaveLength(0);
    expect(pairStandIns([bridge()], [upload({ transferredAt: at("2026-09-27T02:43:00Z") })])).toHaveLength(0);
  });

  it("gives two identical payments on one day one row each", () => {
    const pairs = pairStandIns(
      [bridge({ fingerprint: "line:a" }), bridge({ fingerprint: "line:b" })],
      [upload({ fingerprint: "f1" }), upload({ fingerprint: "f2" })]
    );
    expect(pairs.map((p) => p.real.fingerprint).sort()).toEqual(["f1", "f2"]);
  });

  it("does not pair a stand-in with only one copy for two", () => {
    const pairs = pairStandIns(
      [bridge({ fingerprint: "line:a" }), bridge({ fingerprint: "line:b" })],
      [upload({ fingerprint: "f1" })]
    );
    expect(pairs).toHaveLength(1);
  });

  it("prefers the copy already counted for the same member", () => {
    const pairs = pairStandIns(
      [bridge()],
      [upload({ fingerprint: "other", memberNumber: "11111" }), upload({ fingerprint: "mine" })]
    );
    expect(pairs[0].real.fingerprint).toBe("mine");
  });

  it("ignores shares of a unit's line and rows with nothing to match on", () => {
    expect(isStandIn("line:abc#29746")).toBe(false);
    expect(pairStandIns([bridge({ fingerprint: "line:abc#29746" })], [upload()])).toHaveLength(0);
    expect(pairStandIns([bridge({ transferredAt: null })], [upload()])).toHaveLength(0);
    expect(pairStandIns([bridge({ accountNumber: "" })], [upload({ accountNumber: "" })])).toHaveLength(0);
  });
});
