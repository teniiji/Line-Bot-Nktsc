import { describe, expect, it } from "vitest";
import { REPEAT_SILENCE_WINDOW_MS, repeatsLastReply } from "../lib/replyKind";

const at = (msAgo: number) => new Date(Date.now() - msAgo);
const NOW = new Date();
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("repeatsLastReply", () => {
  it("holds back the same non-answer twice in a row", () => {
    // The five ceremony photos: one album, five events, five runs of the
    // agent, each deciding on its own to ask what the member needs.
    expect(
      repeatsLastReply({ kind: "asked-what-they-need", at: ago(4000) }, "asked-what-they-need", NOW)
    ).toBe(true);
  });

  it("sends the first one", () => {
    expect(repeatsLastReply(null, "asked-what-they-need", NOW)).toBe(false);
  });

  it("never holds back a reply that carries no kind", () => {
    // Everything else the bot says — a slip confirmed, an amount asked for,
    // a question answered. Three slips in one album are three payments and
    // the member needs three answers.
    expect(
      repeatsLastReply({ kind: "asked-what-they-need", at: ago(1000) }, null, NOW)
    ).toBe(false);
  });

  it("sends it again once the window has passed", () => {
    // Somebody coming back later gets an answer, not silence.
    expect(
      repeatsLastReply(
        { kind: "asked-what-they-need", at: ago(REPEAT_SILENCE_WINDOW_MS + 1000) },
        "asked-what-they-need",
        NOW
      )
    ).toBe(false);
  });

  it("still holds back at the edge of the window", () => {
    expect(
      repeatsLastReply(
        { kind: "asked-what-they-need", at: ago(REPEAT_SILENCE_WINDOW_MS) },
        "asked-what-they-need",
        NOW
      )
    ).toBe(true);
  });

  it("sends it when the last reply was something else", () => {
    expect(
      repeatsLastReply({ kind: null, at: ago(1000) }, "asked-what-they-need", NOW)
    ).toBe(false);
  });

  it("does not let clock skew silence a reply", () => {
    // A timestamp from the future is the app and the database disagreeing,
    // and disagreement must never be a reason to say nothing.
    expect(
      repeatsLastReply({ kind: "asked-what-they-need", at: new Date(NOW.getTime() + 60_000) }, "asked-what-they-need", NOW)
    ).toBe(false);
  });

  it("covers a member adding photos over a couple of minutes", () => {
    expect(
      repeatsLastReply({ kind: "asked-what-they-need", at: at(2 * 60 * 1000) }, "asked-what-they-need", new Date())
    ).toBe(true);
  });
});
