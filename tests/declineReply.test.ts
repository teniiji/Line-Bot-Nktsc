import { describe, expect, it } from "vitest";
import { declineReplyInstruction } from "../lib/declineReply";

describe("declineReplyInstruction, nothing pending", () => {
  // The envelope photo: a member sent a picture of a letter envelope and was
  // told "that is not a transfer slip, please send the slip again" — asked for
  // the one thing they did not have, about a payment they never mentioned.
  const text = declineReplyInstruction({
    reason: "not a transaction slip",
    awaitingSlip: false,
  });

  it("tells the reply to say what the picture actually shows", () => {
    expect(text).toContain("say plainly what the picture actually shows");
  });

  it("tells the reply to ask what the member wants", () => {
    expect(text).toContain("ask what they would like to do");
  });

  it("forbids asking for a slip", () => {
    expect(text).toContain("DO NOT ask them to send a transfer slip");
  });

  it("says why, so the rule survives a rewrite of the prompt around it", () => {
    expect(text).toContain("may never have intended to send a payment");
  });

  it("still refuses to invent what it cannot see", () => {
    // The half of the old instruction that was right.
    expect(text).toContain("Do not invent details");
  });

  it("carries the model's own reason through", () => {
    expect(text).toContain("not a transaction slip");
  });
});

describe("declineReplyInstruction, a slip is genuinely awaited", () => {
  // The case the blanket rule would have broken: a transaction really is
  // sitting there waiting for its slip, so asking again is correct.
  const text = declineReplyInstruction({
    reason: "slip shows the transfer failed",
    awaitingSlip: true,
  });

  it("does ask for the slip", () => {
    expect(text).toContain("ask them to send the transfer slip");
  });

  it("does not carry the prohibition meant for the other case", () => {
    expect(text).not.toContain("DO NOT ask them to send a transfer slip");
  });

  it("still says what the picture shows first", () => {
    expect(text).toContain("say briefly what the picture actually shows");
  });
});

describe("declineReplyInstruction, what it must never claim", () => {
  // One of the five runs over one album told the member the photo had been
  // sent before. It had not — they were five different photographs, and this
  // instruction is written for a run that can see none of the others.
  const instruction = declineReplyInstruction({ reason: "งานพิธี", awaitingSlip: false });

  it("forbids calling the picture a repeat", () => {
    expect(instruction).toContain("NEVER say or imply that this picture was sent before");
  });

  it("forbids guessing at the occasion", () => {
    expect(instruction).toContain("do not guess at why they sent it");
  });

  it("gives the member somewhere to go", () => {
    // An open question with no way forward is what left them stuck.
    expect(instruction).toContain("staff can see");
  });

  it("asks for it short", () => {
    expect(instruction).toContain("two or three sentences");
  });

  it("leaves the awaiting-slip case alone", () => {
    // A member genuinely mid-way through sending a slip is asked for it, and
    // every attempt still gets an answer.
    const awaiting = declineReplyInstruction({ reason: "เบลอ", awaitingSlip: true });
    expect(awaiting).toContain("ask them to send the transfer slip");
    expect(awaiting).not.toContain("NEVER say or imply");
  });
});
