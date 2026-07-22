import { describe, expect, it } from "vitest";
import { classifyRecipient } from "../lib/recipientCheck";

describe("classifyRecipient", () => {
  it("accepts the cooperative's full name", () => {
    expect(classifyRecipient("สหกรณ์ออมทรัพย์ครูหนองคาย จำกัด")).toBe("cooperative");
  });

  it("accepts abbreviated and masked cooperative renderings", () => {
    expect(classifyRecipient("สอ.ครูหนองคาย")).toBe("cooperative");
    expect(classifyRecipient("สหกรณ์ออมทรัพย์ครูหนองค***")).toBe("cooperative");
    expect(classifyRecipient("สหกรณ์ ออมทรัพย์ ครูหนองคาย")).toBe("cooperative");
  });

  it("rejects recipients with personal-name titles (the reported bug case)", () => {
    expect(classifyRecipient("ด.ญ. กนกพร หนูจันทร์")).toBe("person");
    expect(classifyRecipient("นาง นิตยา ห***")).toBe("person");
    expect(classifyRecipient("นายสมชาย ใจดี")).toBe("person");
    expect(classifyRecipient("น.ส.สุดาวดี ทองดี")).toBe("person");
    expect(classifyRecipient("MR. SOMCHAI JAIDEE")).toBe("person");
  });

  it("leaves shops/companies/unfamiliar names to the model's judgment", () => {
    expect(classifyRecipient("ร้านค้าสวัสดี")).toBe("unknown");
    expect(classifyRecipient("NONGKHAI TEACHER SAVING COOP")).toBe("unknown");
    expect(classifyRecipient("")).toBe("unknown");
  });

  it("never misreads สหกรณ์อื่น as a person", () => {
    // A transfer to a *different* cooperative still says สหกรณ — accepting it
    // here is the documented trade-off (model judgment can still decline);
    // the deterministic check only has to never block our own account.
    expect(classifyRecipient("สหกรณ์ออมทรัพย์ครูอุดรธานี")).toBe("cooperative");
  });
});
