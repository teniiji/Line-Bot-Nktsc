import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { buildInitialUserMessage } from "../lib/agent/messages";

describe("buildInitialUserMessage", () => {
  it("leaves plain-text content unmarked (single-call flows gain nothing)", () => {
    const message = buildInitialUserMessage("สวัสดีค่ะ");
    expect(message).toEqual({ role: "user", content: "สวัสดีค่ะ" });
  });

  it("marks only the last block of an attachment message with cache_control", () => {
    const content: Anthropic.MessageParam["content"] = [
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: "aGVsbG8=" },
      },
      { type: "text", text: "นี่คือรูปที่ผู้ใช้ส่งมา" },
    ];
    const message = buildInitialUserMessage(content);
    const blocks = message.content as Array<{ cache_control?: unknown }>;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].cache_control).toBeUndefined();
    expect(blocks[1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("does not mutate the caller's blocks", () => {
    const content: Anthropic.MessageParam["content"] = [
      { type: "text", text: "เอกสารแนบ" },
    ];
    buildInitialUserMessage(content);
    expect(
      (content[0] as { cache_control?: unknown }).cache_control
    ).toBeUndefined();
  });
});
