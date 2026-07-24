import { describe, expect, it } from "vitest";
import { DEFAULT_KNOWLEDGE } from "../lib/knowledge";

describe("DEFAULT_KNOWLEDGE contact entry", () => {
  it("keeps the real nktsc.org@gmail.com address readable", () => {
    const contact = DEFAULT_KNOWLEDGE.find((e) => e.key === "contact");
    expect(contact?.content).toContain("gmail.com");
    // The word joiner is invisible but must survive round-tripping.
    expect(contact?.content).toContain("nktsc⁠.org@gmail.com");
  });

  it("never contains the bare nktsc.org substring LINE auto-links into a preview card", () => {
    // A live test showed LINE rendering a link-preview card (pointing at
    // unrelated/gambling content on the now-expired nktsc.org domain) for
    // this substring even with no "http(s)://" scheme present — every
    // occurrence must have a word joiner breaking the "nktsc.org" pattern.
    const contact = DEFAULT_KNOWLEDGE.find((e) => e.key === "contact");
    expect(contact?.content).not.toContain("nktsc.org");
  });
});

describe("DEFAULT_KNOWLEDGE", () => {
  it("has a unique key per entry (KnowledgeEntry.key is a DB unique column)", () => {
    const keys = DEFAULT_KNOWLEDGE.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includes the mai-dai payment and loan eligibility facts pulled from the LINE OA FAQ", () => {
    const maiDai = DEFAULT_KNOWLEDGE.find((e) => e.key === "mai_dai_payment");
    expect(maiDai?.content).toContain("413-1-00127-6");
    expect(maiDai?.content).toContain("447-0-32262-8");

    const loanEligibility = DEFAULT_KNOWLEDGE.find((e) => e.key === "loan_eligibility");
    expect(loanEligibility?.content).toContain("เงินเดือนคงเหลือ");
  });
});
