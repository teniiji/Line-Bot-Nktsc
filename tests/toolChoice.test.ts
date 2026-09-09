import { describe, expect, it } from "vitest";
import { forcedToolChoice, toolsForMessage, type TurnState } from "../lib/agent/toolChoice";
import { tools } from "../lib/agent/tools";

const idle: TurnState = {
  turn: 0,
  hasAttachment: false,
  next: null,
  serviceNext: null,
  lookupNext: null,
};

const state = (over: Partial<TurnState>): TurnState => ({ ...idle, ...over });

describe("forcedToolChoice", () => {
  it("requires a tool call while a transaction is waiting, without naming one", () => {
    // The change this module exists for. A turn pinned to submit_member_info
    // can record only the identity out of "ดำรงชีพ ATM น.ส.กาญจภัษฐ์
    // วงษ์สวรรค์"; "any" lets the same turn record the loan type too.
    expect(forcedToolChoice(state({ next: "member_info" }))).toEqual({ type: "any" });
    expect(forcedToolChoice(state({ next: "loan_type" }))).toEqual({ type: "any" });
    expect(forcedToolChoice(state({ next: "category" }))).toEqual({ type: "any" });
    expect(forcedToolChoice(state({ next: "deposit_account" }))).toEqual({ type: "any" });
    expect(forcedToolChoice(state({ next: "confirm_sender_name" }))).toEqual({ type: "any" });
  });

  it("does the same for a service request", () => {
    expect(forcedToolChoice(state({ serviceNext: "purpose" }))).toEqual({ type: "any" });
    expect(forcedToolChoice(state({ serviceNext: "member_info" }))).toEqual({ type: "any" });
    expect(forcedToolChoice(state({ serviceNext: "phone" }))).toEqual({ type: "any" });
  });

  it("keeps the member-number lookup pinned to its own tool", () => {
    // Not an inconsistency. The lookup asks for a name too, so an unpinned
    // turn can answer it through submit_member_info and write a 13-digit
    // national ID into the member number column — which happened in
    // production, and is why that tool carries a deterministic guard.
    expect(forcedToolChoice(state({ lookupNext: "full_name" }))).toEqual({
      type: "tool",
      name: "submit_lookup_info",
    });
    expect(forcedToolChoice(state({ lookupNext: "national_id" }))).toEqual({
      type: "tool",
      name: "submit_lookup_info",
    });
  });

  it("still requires a tool call on a picture, and still names none", () => {
    // A picture always needs judgement about what it is, so it was never
    // pinned. It also outranks a waiting flow: a new slip arriving mid-flow
    // is read on its own terms.
    expect(forcedToolChoice(state({ hasAttachment: true }))).toEqual({ type: "any" });
    expect(
      forcedToolChoice(state({ hasAttachment: true, next: "member_info" }))
    ).toEqual({ type: "any" });
    expect(
      forcedToolChoice(state({ hasAttachment: true, lookupNext: "full_name" }))
    ).toEqual({ type: "any" });
  });

  it("forces nothing when no flow is waiting", () => {
    // A general question ("ดอกเบี้ยเงินฝากเท่าไหร่คะ") is answered from the
    // knowledge block with no tool at all. Forcing one here would invent a
    // tool call for a question that needs none.
    expect(forcedToolChoice(idle)).toBeUndefined();
  });

  it("forces nothing after the first turn, whatever is waiting", () => {
    // Turn 0 is the one where a plain-text reply would lose information.
    // After it the model holds a tool result and has to be free to write.
    for (const turn of [1, 2]) {
      expect(forcedToolChoice(state({ turn, next: "member_info" }))).toBeUndefined();
      expect(forcedToolChoice(state({ turn, hasAttachment: true }))).toBeUndefined();
      expect(forcedToolChoice(state({ turn, lookupNext: "phone" }))).toBeUndefined();
    }
  });
});

describe("toolsForMessage", () => {
  it("withholds the picture-only tools from a message with no picture", () => {
    // The reason "any" is safe. Told to call something about "หาก่อนนะคะ",
    // the model could otherwise reach for the tool that tells the member
    // their image was unreadable — when they sent no image.
    const offered = toolsForMessage(tools, false).map((t) => t.name);
    expect(offered).not.toContain("decline_unreadable_image");
    expect(offered).not.toContain("flag_supporting_document");
  });

  it("offers everything when a picture is attached", () => {
    const offered = toolsForMessage(tools, true).map((t) => t.name);
    expect(offered).toContain("decline_unreadable_image");
    expect(offered).toContain("flag_supporting_document");
    expect(offered).toHaveLength(tools.length);
  });

  it("keeps every tool a text message can actually need", () => {
    // Withholding one of these would break a flow outright, so the list is
    // asserted rather than left to a filter nobody re-reads.
    const offered = toolsForMessage(tools, false).map((t) => t.name);
    for (const name of [
      "report_transaction",
      "submit_member_info",
      "submit_loan_type",
      "submit_deposit_account",
      "confirm_transaction_sender",
      "submit_service_purpose",
      "submit_contact_phone",
      "request_staff_help",
      "submit_lookup_info",
      "get_transaction_summary",
      "set_nickname",
    ]) {
      expect(offered, name).toContain(name);
    }
  });

  it("does not mutate the list it was given", () => {
    const before = tools.length;
    toolsForMessage(tools, false);
    toolsForMessage(tools, true);
    expect(tools).toHaveLength(before);
  });
});
