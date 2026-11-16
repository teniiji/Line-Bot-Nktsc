import { describe, expect, it } from "vitest";
import { acceptsForcedToolChoice, fallbackModelFor, resolveToolChoice } from "../lib/agent/models";

describe("enforcing a required tool call per model", () => {
  it("keeps a forced choice where the model takes one", () => {
    expect(acceptsForcedToolChoice("claude-haiku-5-5")).toBe(true);
    expect(acceptsForcedToolChoice("claude-sonnet-5")).toBe(true);
    expect(resolveToolChoice("claude-haiku-5-5", { type: "tool", name: "submit_lookup_info" })).toEqual({
      toolChoice: { type: "tool", name: "submit_lookup_info" },
      mustCallTool: false,
    });
  });

  it("asks with auto and checks afterwards where a forced choice is a 400", () => {
    expect(acceptsForcedToolChoice("claude-sonnet-5-5")).toBe(false);
    expect(acceptsForcedToolChoice("claude-fable-5-2")).toBe(false);
    expect(resolveToolChoice("claude-sonnet-5-5", { type: "any" })).toEqual({
      toolChoice: { type: "auto" },
      mustCallTool: true,
    });
  });

  it("leaves a turn with no requirement alone", () => {
    expect(resolveToolChoice("claude-sonnet-5-5", undefined)).toEqual({ toolChoice: undefined, mustCallTool: false });
  });

  it("falls back only from Claude Sonnet 5.5", () => {
    expect(fallbackModelFor("claude-sonnet-5-5")).toBe("claude-sonnet-5");
    expect(fallbackModelFor("claude-haiku-5-5")).toBeNull();
  });
});
