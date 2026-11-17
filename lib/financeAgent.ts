// The finance agent's runner: picks a model, assembles the (cached) system
// prompt + tools, and drives the tool-use loop. The pieces it assembles
// live in lib/agent/ — types, conversation state, tool schemas, the system
// prompt, staff forwarding, and the tool handlers — so each can be read
// and changed on its own.
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./anthropicClient";
import { getKnowledgeText } from "./knowledge";
import { getFormLinksData } from "./formLinks";
import { sanitiseReplyText } from "./replyText";
import { tools } from "./agent/tools";
import { forcedToolChoice, toolsForMessage } from "./agent/toolChoice";
import { buildSystemPrompt } from "./agent/prompts";
import { isAcknowledgementOnly, closingNote } from "./closingReply";
import { recentReplyNote } from "./recentReply";
import { messageHintNote } from "./messageHints";
import { quotedMessageNote } from "./quotedMessage";
import {
  loadLineUser,
  loadAllPending,
  loadPendingServiceRequest,
  loadPendingLookup,
  loadDisabledRequirements,
  loadRecentAction,
  loadPreviousReply,
  loadQuotedMessage,
  computeNextRequirement,
  computeServiceRequirement,
  computeLookupRequirement,
  computeQuickReplies,
} from "./agent/state";
import { executeTool } from "./agent/handlers";
import {
  EFFORT,
  MAX_TOKENS,
  SLIP_MODEL,
  TEXT_MODEL,
  fallbackModelFor,
  mustCallToolNote,
  resolveToolChoice,
} from "./agent/models";
import { buildInitialUserMessage } from "./agent/messages";
import type { FinanceAgentReply, ToolContext } from "./agent/types";
import type { ReplyKind } from "./replyKind";

export type { FinanceAgentReply } from "./agent/types";

// Which model answers, how hard it thinks, and how a required tool call is
// enforced on it — see lib/agent/models.ts. Haiku has misread slips with
// busy/themed backgrounds, so a message with an image or PDF goes to the
// stronger model.

const MAX_TOOL_TURNS = 3;

// One call to the model. Claude Sonnet 5.5 goes through the Messages API's
// server-side fallback (a beta): a request it declines is re-run on Claude
// Sonnet 5 within the same call instead of reaching the member as "ไม่สามารถ
// ตอบได้". Request and response keep the shapes this agent sends and reads.
async function callModel(
  params: Anthropic.MessageCreateParamsNonStreaming
): Promise<Anthropic.Message> {
  const fallback = fallbackModelFor(params.model);
  const response = fallback
    ? ((await anthropic.beta.messages.create({
        ...(params as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming),
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: [{ model: fallback }],
      })) as unknown as Anthropic.Message)
    : await anthropic.messages.create(params);
  // A decline (or a reply cut off by the token cap) used to surface only as
  // the generic apology; say why in the logs.
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
    console.error(
      "[financeAgent] model stopped early:",
      JSON.stringify({ model: response.model, stopReason: response.stop_reason, stopDetails: response.stop_details })
    );
  }
  return response;
}

// True for either an image (photo) or a document (PDF) attachment — the
// two ways a member can send a slip or supporting document. Used to decide
// which model to use, whether to force a specific tool, and whether an
// attachment was present at all; callers that need to know the exact kind
// (e.g. for the staff-forwarding message format) use ctx.slipIsPdf instead.
function hasAttachmentContent(content: Anthropic.MessageParam["content"]): boolean {
  return (
    typeof content !== "string" &&
    content.some((block) => block.type === "image" || block.type === "document")
  );
}

// The member's message as plain text, or null when anything else came with
// it — a photo is never a bare "ขอบคุณค่ะ", whatever caption is attached.
function plainTextOf(content: Anthropic.MessageParam["content"]): string | null {
  if (typeof content === "string") return content;
  if (content.some((block) => block.type !== "text")) return null;
  return content.map((block) => (block.type === "text" ? block.text : "")).join(" ");
}

export async function runFinanceAgent(
  userContent: Anthropic.MessageParam["content"],
  lineUserId: string,
  slipImageUrlPromise: Promise<string | null> = Promise.resolve(null),
  slipImageHash: string | null = null,
  slipIsPdf: boolean = false,
  // The id of the message this one was sent as a reply to, straight off the
  // webhook event — null on the great majority of messages, which quote
  // nothing.
  quotedMessageId: string | null = null
): Promise<FinanceAgentReply> {
  // Decided before the loads so the recent-action lookup joins them in the
  // same round trip instead of adding a second one — and is skipped entirely
  // on every ordinary message, which is nearly all of them.
  const messageText = plainTextOf(userContent);
  const isAcknowledgement = messageText !== null && isAcknowledgementOnly(messageText);

  const [lineUser, queuedPending, pendingService, pendingLookup, knowledgeText, formLinksData, disabledRequirements, recentAction, previousReply, quoted] =
    await Promise.all([
      loadLineUser(lineUserId),
      loadAllPending(lineUserId),
      loadPendingServiceRequest(lineUserId),
      loadPendingLookup(lineUserId),
      getKnowledgeText(),
      getFormLinksData(),
      loadDisabledRequirements(),
      isAcknowledgement ? loadRecentAction(lineUserId) : Promise.resolve(null),
      loadPreviousReply(lineUserId),
      // Joins the same round trip, and is skipped entirely on a message that
      // quotes nothing — nearly all of them.
      quotedMessageId
        ? loadQuotedMessage(lineUserId, quotedMessageId)
        : Promise.resolve(null),
    ]);

  // The caller kicks off the Blob upload before calling this function but
  // doesn't await it, so it runs concurrently with the first Claude API
  // round-trip below instead of blocking it. Only resolve it once a tool
  // call actually needs it.
  let resolvedSlipImageUrl: string | null | undefined;
  async function resolveSlipImageUrl(): Promise<string | null> {
    if (resolvedSlipImageUrl === undefined) {
      resolvedSlipImageUrl = await slipImageUrlPromise;
    }
    return resolvedSlipImageUrl;
  }

  // The oldest waiting payment is the one the bot is asking about; the count
  // tells the model not to answer as though only one slip had arrived.
  const pending = queuedPending[0] ?? null;

  // A sign-off closes the conversation even when something is still pending.
  //
  // The flow note used to keep the floor whenever a flow existed, on the
  // grounds that politeness mid-conversation is not the end of one. But a
  // member who says only "ขอบคุณครับ" has been answered by somebody, and in a
  // chat staff read that somebody is often staff — whose messages never reach
  // this bot. Asking again for what the flow is still missing is then the
  // fourth time of asking for something that is already on the member's
  // screen. See PENDING_RULES in lib/closingReply.ts.
  const hasPendingFlow = pending !== null || pendingService !== null || pendingLookup !== null;
  const closing = isAcknowledgement ? closingNote(true, recentAction, hasPendingFlow) : "";

  // What the bot said a moment ago, so two messages typed in the same breath
  // do not get two answers saying the same thing.
  const previousNote = recentReplyNote(previousReply, new Date());

  // What this message already answered. Only ever asked about things still
  // outstanding: a hint about a name already on record would invite the model
  // to overwrite the roster's spelling with one read out of a sentence.
  const hints = messageHintNote({
    text: messageText,
    needsName: !lineUser?.fullName,
    needsCategory: pending !== null && !pending.category,
  });

  // The message the member tapped ตอบกลับ on — the subject of the sentence
  // they just typed, which the model has no other way of seeing.
  const quotedNote = quotedMessageNote(quotedMessageId !== null, quoted);

  const { base, dynamic } = buildSystemPrompt(
    lineUser,
    pending,
    pendingService,
    pendingLookup,
    knowledgeText,
    formLinksData.text,
    disabledRequirements,
    queuedPending.length,
    closing,
    previousNote,
    hints,
    quotedNote
  );
  // A cache breakpoint on the static base block caches everything before it
  // in the request (all tool definitions + this base system prompt), since
  // Anthropic's cacheable prefix runs tools → system → messages. The
  // dynamic block (date + flow note) sits after the breakpoint and is read
  // fresh each message. Cuts the per-message cost of the large, unchanging
  // instructions to a fraction after the first call. The knowledge block
  // inside base is stable between dashboard edits (60s in-memory cache in
  // lib/knowledge.ts), so an edit costs one fresh cache write — rare.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: base, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamic },
  ];
  const isAttachment = hasAttachmentContent(userContent);
  const model = isAttachment ? SLIP_MODEL : TEXT_MODEL;
  const effort = EFFORT[isAttachment ? "slip" : "text"];
  // buildInitialUserMessage adds a second cache breakpoint on a slip
  // attachment so the loop's later calls read the image from cache.
  const messages: Anthropic.MessageParam[] = [buildInitialUserMessage(userContent)];
  // A tool that can only be about a picture is not offered on a message that
  // has none — see toolsForMessage.
  const availableTools = toolsForMessage(
    tools,
    hasAttachmentContent(userContent),
    pending !== null || pendingService !== null || pendingLookup !== null
  );

  // Set by a tool whose reply can repeat itself into noise, and read by the
  // caller to decide whether to send this one at all — see lib/replyKind.ts.
  let replyKind: ReplyKind = null;
  let holdingReply: string | null = null;

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    // Which tool call, if any, this turn is required to make — see
    // lib/agent/toolChoice.ts for why turn 0 is forced and why only the
    // member-number lookup is pinned to one named tool.
    const next = pending
      ? computeNextRequirement(lineUser, pending, disabledRequirements)
      : null;
    const serviceNext =
      !pending && pendingService ? computeServiceRequirement(lineUser, pendingService) : null;
    const lookupNext =
      !pending && !pendingService && pendingLookup
        ? computeLookupRequirement(pendingLookup)
        : null;
    const forced = forcedToolChoice({
      turn,
      hasAttachment: hasAttachmentContent(userContent),
      next,
      serviceNext,
      lookupNext,
    });
    // A model that cannot be forced is asked with "auto" and checked.
    const { toolChoice, mustCallTool } = resolveToolChoice(model, forced);
    const ask = () =>
      callModel({
        model,
        max_tokens: MAX_TOKENS,
        system,
        tools: availableTools,
        messages,
        output_config: { effort },
        ...(toolChoice ? { tool_choice: toolChoice } : {}),
      });
    let response = await ask();
    if (mustCallTool && !response.content.some((block) => block.type === "tool_use")) {
      // Once more, with the requirement said outright. The note stays in the
      // conversation: the reply after it was written with it in view, and
      // taking it out later would change what came before that reply.
      console.warn(`[financeAgent] ${model} answered without a required tool call; asking again`);
      messages.push({ role: "system", content: mustCallToolNote(forced) });
      response = await ask();
    }

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    if (toolUseBlocks.length === 0) {
      // When a server tool (web_search/web_fetch) runs mid-turn, the model
      // often emits a text block *before* calling it (e.g. "กำลังค้นหาข้อมูล
      // ให้ค่ะ...") in addition to the real answer *after* the tool result.
      // The first text block was being sent to the user as the reply —
      // always a filler acknowledgement, never the actual answer. Use the
      // last text block instead, which is the one written with the tool
      // result in hand.
      const textBlock = response.content.findLast(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );
      const text = textBlock?.text.trim();
      // Server tools resolve within this same response (server_tool_use +
      // a *_tool_result block) rather than as a client tool_use block, so
      // they never show up in toolUseBlocks above. Log what ran and what
      // came back so a reply that wrongly claims "no info available" (or,
      // as above, sends only a pre-tool-call filler line) can be diagnosed
      // from Vercel logs instead of guessing.
      const serverToolResults = response.content.filter((b) =>
        b.type === "web_fetch_tool_result" || b.type === "web_search_tool_result"
      );
      console.log(
        `[financeAgent] no client tool called on turn ${turn}`,
        JSON.stringify({
          contentTypes: response.content.map((b) => b.type),
          textBlockCount: response.content.filter((b) => b.type === "text").length,
          serverToolResults: serverToolResults.map((b) => JSON.stringify(b).slice(0, 500)),
        })
      );
      if (!text) {
        console.error(
          "[financeAgent] empty model response, falling back:",
          JSON.stringify({
            stopReason: response.stop_reason,
            contentTypes: response.content.map((b) => b.type),
          })
        );
      }
      return {
        text: sanitiseReplyText(
          text || "ขอโทษค่ะ ไม่สามารถตอบได้ในตอนนี้",
          formLinksData.hosts
        ),
        quickReplies: await computeQuickReplies(lineUserId),
        replyKind,
        holdingReply,
      };
    }

    messages.push({ role: "assistant", content: response.content });

    const ctx: ToolContext = {
      lineUserId,
      noteReplyKind: (kind) => {
        replyKind = kind;
      },
      noteHoldingReply: (text) => {
        holdingReply = text;
      },
      slipImageUrl: await resolveSlipImageUrl(),
      slipImageHash,
      hasSlipImage: hasAttachmentContent(userContent),
      slipIsPdf,
    };
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const result = await executeTool(block.name, block.input, ctx);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  // The loop above may have already committed a tool's side effect (e.g.
  // logged an expense) on its final turn without getting a chance to reply.
  // Make one more call with tools disabled so the model must summarize what
  // actually happened instead of the caller returning a generic "failed"
  // message for work that already succeeded.
  // Tools stay in the request with tool_choice "none" rather than being
  // dropped: thinking blocks from the turns above stay valid only while
  // everything sent before them is unchanged, tools included.
  const finalResponse = await callModel({
    model,
    max_tokens: MAX_TOKENS,
    system,
    tools: availableTools,
    tool_choice: { type: "none" },
    messages,
    output_config: { effort },
  });
  const finalText = finalResponse.content.findLast(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  return {
    text: sanitiseReplyText(
      finalText?.text.trim() || "ขอโทษค่ะ ดำเนินการไม่สำเร็จ ลองใหม่อีกครั้งนะคะ",
      formLinksData.hosts
    ),
    quickReplies: await computeQuickReplies(lineUserId),
    replyKind,
    holdingReply,
  };
}

