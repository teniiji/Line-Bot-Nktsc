// The finance agent's runner: picks a model, assembles the (cached) system
// prompt + tools, and drives the tool-use loop. The pieces it assembles
// live in lib/agent/ — types, conversation state, tool schemas, the system
// prompt, staff forwarding, and the tool handlers — so each can be read
// and changed on its own.
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./anthropicClient";
import { getKnowledgeText } from "./knowledge";
import { stripDisallowedLinks } from "./links";
import { tools } from "./agent/tools";
import { buildSystemPrompt } from "./agent/prompts";
import {
  loadLineUser,
  loadPending,
  loadPendingServiceRequest,
  loadPendingLookup,
  computeNextRequirement,
  computeServiceRequirement,
  computeLookupRequirement,
  computeQuickReplies,
} from "./agent/state";
import { executeTool } from "./agent/handlers";
import { buildInitialUserMessage } from "./agent/messages";
import type { FinanceAgentReply, ToolContext } from "./agent/types";

export type { FinanceAgentReply } from "./agent/types";

// Haiku is fast/cheap and reliable for plain text, but has repeatedly
// misread slips with busy/themed backgrounds (inventing reasons to decline
// a perfectly legible transaction). Use a stronger model whenever the
// message includes an image or PDF attachment.
const TEXT_MODEL = "claude-haiku-4-5";

const VISION_MODEL = "claude-sonnet-5";

const MAX_TOOL_TURNS = 3;

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

export async function runFinanceAgent(
  userContent: Anthropic.MessageParam["content"],
  lineUserId: string,
  slipImageUrlPromise: Promise<string | null> = Promise.resolve(null),
  slipImageHash: string | null = null,
  slipIsPdf: boolean = false
): Promise<FinanceAgentReply> {
  const [lineUser, pending, pendingService, pendingLookup, knowledgeText] = await Promise.all([
    loadLineUser(lineUserId),
    loadPending(lineUserId),
    loadPendingServiceRequest(lineUserId),
    loadPendingLookup(lineUserId),
    getKnowledgeText(),
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

  const { base, dynamic } = buildSystemPrompt(
    lineUser,
    pending,
    pendingService,
    pendingLookup,
    knowledgeText
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
  const model = hasAttachmentContent(userContent) ? VISION_MODEL : TEXT_MODEL;
  // buildInitialUserMessage adds a second cache breakpoint on a slip
  // attachment so the loop's later calls read the image from cache.
  const messages: Anthropic.MessageParam[] = [buildInitialUserMessage(userContent)];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    // The model tends to respond with plain text instead of calling a tool
    // when it wants to ask something. Force the specific tool the pending
    // transaction is waiting on so a text reply naming member info / loan
    // type is never silently dropped as a bare text response. Images
    // always need vision judgement (real slip vs. not), so those force
    // "any" tool rather than a single named one.
    let toolChoice: Anthropic.ToolChoice | undefined;
    const next = pending ? computeNextRequirement(lineUser, pending) : null;
    const serviceNext =
      !pending && pendingService ? computeServiceRequirement(lineUser, pendingService) : null;
    const lookupNext =
      !pending && !pendingService && pendingLookup
        ? computeLookupRequirement(pendingLookup)
        : null;
    if (turn === 0 && next === "member_info" && !hasAttachmentContent(userContent)) {
      toolChoice = { type: "tool", name: "submit_member_info" };
    } else if (turn === 0 && next === "category" && !hasAttachmentContent(userContent)) {
      toolChoice = { type: "tool", name: "report_transaction" };
    } else if (turn === 0 && next === "loan_type" && !hasAttachmentContent(userContent)) {
      toolChoice = { type: "tool", name: "submit_loan_type" };
    } else if (turn === 0 && next === "deposit_account" && !hasAttachmentContent(userContent)) {
      toolChoice = { type: "tool", name: "submit_deposit_account" };
    } else if (turn === 0 && next === "confirm_sender_name" && !hasAttachmentContent(userContent)) {
      toolChoice = { type: "tool", name: "confirm_transaction_sender" };
    } else if (turn === 0 && serviceNext === "purpose" && !hasAttachmentContent(userContent)) {
      toolChoice = { type: "tool", name: "submit_service_purpose" };
    } else if (turn === 0 && serviceNext === "member_info" && !hasAttachmentContent(userContent)) {
      toolChoice = { type: "tool", name: "submit_member_info" };
    } else if (turn === 0 && serviceNext === "phone" && !hasAttachmentContent(userContent)) {
      toolChoice = { type: "tool", name: "submit_contact_phone" };
    } else if (turn === 0 && lookupNext !== null && !hasAttachmentContent(userContent)) {
      toolChoice = { type: "tool", name: "submit_lookup_info" };
    } else if (turn === 0 && hasAttachmentContent(userContent)) {
      toolChoice = { type: "any" };
    }
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system,
      tools,
      messages,
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
    });

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
        text: stripDisallowedLinks(text || "ขอโทษค่ะ ไม่สามารถตอบได้ในตอนนี้"),
        quickReplies: await computeQuickReplies(lineUserId),
      };
    }

    messages.push({ role: "assistant", content: response.content });

    const ctx: ToolContext = {
      lineUserId,
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
  const finalResponse = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    system,
    messages,
  });
  const finalText = finalResponse.content.findLast(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  return {
    text: stripDisallowedLinks(
      finalText?.text.trim() || "ขอโทษค่ะ ดำเนินการไม่สำเร็จ ลองใหม่อีกครั้งนะคะ"
    ),
    quickReplies: await computeQuickReplies(lineUserId),
  };
}

