import type Anthropic from "@anthropic-ai/sdk";

// Builds the conversation's first user message. When the message carries an
// attachment (slip image/PDF), its blocks are by far the most expensive part
// of the request, and the tool-use loop in runFinanceAgent re-sends the whole
// conversation up to 4 times (up to 3 tool turns + the final no-tools
// summary call). Marking the last block with a cache breakpoint extends the
// cached prefix (tools → system base → this message) so every call after the
// first reads the attachment from prompt cache at a fraction of the price
// instead of re-billing it in full.
//
// Plain-text messages are left unmarked: they usually resolve in a single
// call (e.g. knowledge questions), where a breakpoint would only add the
// small cache-write surcharge with nothing to reuse it.
export function buildInitialUserMessage(
  content: Anthropic.MessageParam["content"]
): Anthropic.MessageParam {
  if (typeof content === "string") {
    return { role: "user", content };
  }

  // Copy the blocks so the caller's array isn't mutated.
  const blocks = content.map((block) => ({ ...block }));
  const last = blocks[blocks.length - 1];
  if (last) {
    (last as { cache_control?: Anthropic.CacheControlEphemeral }).cache_control = {
      type: "ephemeral",
    };
  }
  return { role: "user", content: blocks };
}
