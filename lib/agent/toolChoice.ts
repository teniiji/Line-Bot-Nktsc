// What the model is allowed and required to do on the first turn of a
// message, and which tools it may pick from at all.
//
// Two separate decisions, both of which used to be inline in the runner's
// loop as a ladder of eleven else-ifs.
//
// The forcing exists because the model answers with plain text when it wants
// to ask a question, and a text reply naming a member number or a loan type
// is information the system never sees — it is dropped as prose. Requiring a
// tool call on the first turn is what stops that.
//
// But requiring one *named* tool is stronger than the problem needs, and it
// costs something real. A member who writes "ดำรงชีพ ATM น.ส.กาญจภัษฐ์
// วงษ์สวรรค์" has said two things; a turn pinned to submit_member_info can
// only record one of them. The other has to survive a second turn to be
// captured at all, which is why that member was asked for their loan type
// twice more. "Any tool" keeps the guarantee — no bare text on turn one —
// while letting one message be recorded in one turn.

import type Anthropic from "@anthropic-ai/sdk";
import type { Requirement, ServiceRequirement, LookupRequirement } from "./types";

// Tools that are only ever about a picture. Offering them on a plain text
// message is what makes "any tool" risky: asked to call something, anything,
// about "หาก่อนนะคะ", the model can reach for the one tool that tells the
// member their image could not be read — when they sent no image. Removing
// them is correct on its own terms, not only as a safety net: neither can
// apply to a message with nothing attached.
const ATTACHMENT_ONLY_TOOLS = new Set([
  "decline_unreadable_image",
  "flag_supporting_document",
]);

// Silence is for a member who asked something nobody here can answer. It is
// never the answer to a half-finished piece of work: a slip waiting on a
// member number, a service request waiting on a phone number. Withheld
// outright while any of those is running, because the first turn of such a
// message is forced to call *some* tool, and this one would end the
// conversation by leaving it unanswered.
const IDLE_ONLY_TOOLS = new Set(["leave_to_staff"]);

export function toolsForMessage<T extends { name: string }>(
  all: readonly T[],
  hasAttachment: boolean,
  flowInProgress: boolean = false
): T[] {
  return all.filter(
    (tool) =>
      (hasAttachment || !ATTACHMENT_ONLY_TOOLS.has(tool.name)) &&
      (!flowInProgress || !IDLE_ONLY_TOOLS.has(tool.name))
  );
}

export interface TurnState {
  // Only the first turn is forced. After that the model has a tool result in
  // hand and needs to be free to write the reply.
  turn: number;
  hasAttachment: boolean;
  // Whatever the pending transaction / service request / member-number
  // lookup is waiting for, or null when that flow is not running.
  next: Requirement;
  serviceNext: ServiceRequirement;
  lookupNext: LookupRequirement;
}

export function forcedToolChoice(state: TurnState): Anthropic.ToolChoice | undefined {
  if (state.turn !== 0) return undefined;

  // A picture always needs the model's judgement about what it is — a real
  // slip, a supporting document, or neither — so it was never pinned to one
  // tool.
  if (state.hasAttachment) return { type: "any" };

  // The member-number lookup keeps a named tool. The two flows are easy to
  // confuse from the outside — both ask for a name — and confusing them here
  // writes a 13-digit national ID into the member number column. There is a
  // deterministic guard against exactly that in submit_member_info, and it
  // exists because the model made this mistake in production. Nothing is
  // gained by giving it the chance again.
  if (state.lookupNext !== null) {
    return { type: "tool", name: "submit_lookup_info" };
  }

  // A transaction or service request waiting on something: a tool call is
  // required, but which one — and how many — is the model's to decide, so a
  // message carrying an answer plus something else lands whole.
  if (state.next !== null || state.serviceNext !== null) {
    return { type: "any" };
  }

  return undefined;
}
