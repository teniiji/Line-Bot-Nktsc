import { describe, expect, it } from "vitest";
import { DEFAULT_KNOWLEDGE } from "../lib/knowledge";

describe("DEFAULT_KNOWLEDGE contact entry", () => {
  const contact = () => DEFAULT_KNOWLEDGE.find((e) => e.key === "contact")?.content ?? "";

  it("carries no email address at all", () => {
    // This used to assert the address was kept readable with a U+2060 WORD
    // JOINER inside it, on the strength of a live test said to confirm the
    // joiner breaks LINE's matcher. It does not. The advert appeared again on
    // 11 Sep, under a conversation in which a member had just sent her
    // national ID number, with that same joiner inserted into the finished
    // reply where nothing could retype it away.
    //
    // There is no way to write the address that a matcher looking for domains
    // will not find, because it is a domain. So the entry does not offer the
    // model one to reach for.
    expect(contact()).not.toContain("gmail.com");
    expect(contact()).not.toContain("@");
  });

  it("contains the nktsc.org substring in no form, joined or bare", () => {
    expect(contact()).not.toContain("nktsc.org");
    expect(contact()).not.toContain("nktsc\u2060.org");
  });

  it("still gives every telephone number staff answer on", () => {
    // Removing the address only helps if what replaces it is usable.
    for (const phone of ["042-411334", "042-423355", "042-420495", "042-413276"]) {
      expect(contact(), phone).toContain(phone);
    }
  });

  it("says why there is no email rather than leaving a gap", () => {
    // A member who asks for the email should be told something, not met with
    // an address the reply strips out on the way to them.
    expect(contact()).toContain("โทรศัพท์");
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
