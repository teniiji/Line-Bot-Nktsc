import { describe, expect, it } from "vitest";
import { startsNewPayment } from "../lib/pendingSlip";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

// The row the bot is currently asking about, after a slip has been received.
const waitingOnSlipA = { activeHasSlip: true, activeSlipHash: HASH_A };
// Nothing pending yet, or a payment described in text with no slip yet.
const nothingPending = { activeHasSlip: false, activeSlipHash: null };

describe("startsNewPayment", () => {
  it("starts a second payment when another slip arrives mid-question", () => {
    // The bug this exists for: one payment to the cooperative and one to
    // ฌาปนกิจสงเคราะห์, sent back to back before the member says who they
    // are. The second used to overwrite the first, and the first was gone.
    expect(
      startsNewPayment({ ...waitingOnSlipA, incomingHasSlip: true, incomingSlipHash: HASH_B })
    ).toBe(true);
  });

  it("does not start one for an answer to the bot's question", () => {
    // "ซื้อหุ้น" — no image, so this is more information about the payment
    // already being asked about.
    expect(
      startsNewPayment({ ...waitingOnSlipA, incomingHasSlip: false, incomingSlipHash: null })
    ).toBe(false);
  });

  it("does not start one when the same image is sent again", () => {
    // A resend, a retried webhook delivery, the member forwarding their own
    // message back. The hash is of the raw bytes, so this is exact.
    expect(
      startsNewPayment({ ...waitingOnSlipA, incomingHasSlip: true, incomingSlipHash: HASH_A })
    ).toBe(false);
  });

  it("attaches the slip to a payment the member described in text first", () => {
    // "โอนไป 5000 ค่าหุ้น" then the slip. One payment, not two.
    expect(
      startsNewPayment({ ...nothingPending, incomingHasSlip: true, incomingSlipHash: HASH_A })
    ).toBe(false);
  });

  it("does not start one when nothing is pending at all", () => {
    expect(
      startsNewPayment({ ...nothingPending, incomingHasSlip: false, incomingSlipHash: null })
    ).toBe(false);
  });

  it("treats a slip it could not hash as a new payment, not an overwrite", () => {
    // If the hash is missing there is no way to tell a resend from a second
    // payment. An extra pending row is a question staff can answer; an
    // overwrite is money gone, so this fails towards keeping both.
    expect(
      startsNewPayment({ ...waitingOnSlipA, incomingHasSlip: true, incomingSlipHash: null })
    ).toBe(true);
  });
});
