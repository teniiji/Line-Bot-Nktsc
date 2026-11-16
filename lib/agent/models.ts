// Which Claude model answers a message, how hard it thinks, and how a turn
// that must call a tool is enforced on it.
//
// Text: Claude Haiku 5.5 — the current Haiku, better at following this
// prompt's many rules than Claude Haiku 4.5 and a tenth of its price per
// token. It still accepts a forced tool_choice, which the text flows rely on
// (lib/agent/toolChoice.ts).
//
// Slips and documents: Claude Sonnet 5.5 — the current Sonnet, same price as
// Claude Sonnet 5. Haiku has misread slips on busy themed backgrounds, so a
// picture still goes to the stronger model. Claude Sonnet 5.5 rejects a
// forced tool_choice ("any" or a named tool) with a 400, so on this model a
// required tool call is asked for with "auto" and checked afterwards: a
// turn that comes back without one is asked again once (financeAgent).
//
// Either can be set back without a code change, through BOT_TEXT_MODEL and
// BOT_SLIP_MODEL on Vercel (e.g. BOT_SLIP_MODEL=claude-sonnet-5).

import type Anthropic from "@anthropic-ai/sdk";

export const TEXT_MODEL = process.env.BOT_TEXT_MODEL?.trim() || "claude-haiku-5-5";
export const SLIP_MODEL = process.env.BOT_SLIP_MODEL?.trim() || "claude-sonnet-5-5";

// Effort replaces Claude Haiku 4.5's thinking budget (it had none here).
// "medium" for both: members wait for the reply in LINE, and the turns that
// matter most — a forced tool call — skip thinking on Haiku anyway. Raise to
// "high" if replies start missing rules; it costs time on every message.
export const EFFORT: Record<"text" | "slip", "low" | "medium" | "high"> = {
  text: "medium",
  slip: "medium",
};

// Thinking counts toward max_tokens on both models, so the 1,024 the bot used
// on Claude Haiku 4.5 could be spent before a word of the reply.
export const MAX_TOKENS = 4096;

// Models that return a 400 on tool_choice "any" or a named tool.
const NO_FORCED_TOOL_CHOICE = /^claude-(sonnet-5-5|opus-5-5|fable-5-[12]|mythos-5-[12])\b/;

export function acceptsForcedToolChoice(model: string): boolean {
  return !NO_FORCED_TOOL_CHOICE.test(model);
}

// The tool_choice to send, and whether a call is still required of this turn
// — for a model that cannot be forced, "auto" plus a check afterwards.
export function resolveToolChoice(
  model: string,
  forced: Anthropic.ToolChoice | undefined
): { toolChoice: Anthropic.ToolChoice | undefined; mustCallTool: boolean } {
  if (!forced || forced.type === "auto" || forced.type === "none") {
    return { toolChoice: forced, mustCallTool: false };
  }
  if (acceptsForcedToolChoice(model)) return { toolChoice: forced, mustCallTool: false };
  return { toolChoice: { type: "auto" }, mustCallTool: true };
}

// Said to a model that answered in plain text on a turn that needed a tool —
// the second and last try (financeAgent).
export function mustCallToolNote(forced: Anthropic.ToolChoice | undefined): string {
  const named = forced?.type === "tool" ? ` (${forced.name})` : "";
  return (
    `ข้อความนี้ต้องจบด้วยการเรียก tool${named} ตามกฎในพรอมป์ ` +
    "ห้ามตอบเป็นข้อความเปล่าโดยไม่เรียก tool — ถ้าเป็นไฟล์แนบ ให้เรียก report_transaction, " +
    "flag_supporting_document หรือ decline_unreadable_image ตามที่ตรวจได้"
  );
}

// Claude Sonnet 5.5 can hand a declined request to Claude Sonnet 5 within the
// same call (server-side fallback). Claude Haiku 5.5 has no fallback.
export function fallbackModelFor(model: string): string | null {
  return model === "claude-sonnet-5-5" ? "claude-sonnet-5" : null;
}
