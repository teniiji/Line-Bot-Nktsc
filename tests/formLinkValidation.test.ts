import { describe, expect, it } from "vitest";
import { validateFormLinkUrl } from "../lib/formLinkValidation";

describe("validateFormLinkUrl", () => {
  it("accepts a normal https URL", () => {
    expect(validateFormLinkUrl("https://drive.google.com/file/d/abc123")).toBeNull();
  });

  it("rejects an unparseable URL", () => {
    expect(validateFormLinkUrl("not-a-url")).not.toBeNull();
  });

  it("rejects a non-http(s) scheme", () => {
    expect(validateFormLinkUrl("ftp://example.com/file")).not.toBeNull();
  });

  it("blocks nktscoop.com and www.nktscoop.com", () => {
    expect(validateFormLinkUrl("https://nktscoop.com/form")).not.toBeNull();
    expect(validateFormLinkUrl("https://www.nktscoop.com/form")).not.toBeNull();
  });

  it("is case-insensitive on the blocked hostname", () => {
    expect(validateFormLinkUrl("https://WWW.NKTSCOOP.COM/form")).not.toBeNull();
  });
});
