import { describe, expect, it } from "vitest";
import { validateFormLinkUrl, BLOCKED_FORM_LINK_HOSTS } from "../lib/formLinkValidation";

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

  it("no longer blocks nktscoop.com (cloaking issue confirmed resolved)", () => {
    expect(validateFormLinkUrl("https://nktscoop.com/form")).toBeNull();
    expect(validateFormLinkUrl("https://www.nktscoop.com/form")).toBeNull();
  });

  it("rejects a hostname added to BLOCKED_FORM_LINK_HOSTS", () => {
    // BLOCKED_FORM_LINK_HOSTS is empty by default (see lib/formLinkValidation.ts) —
    // this only exercises that the mechanism itself still works if a host is added.
    BLOCKED_FORM_LINK_HOSTS.add("evil.example");
    try {
      expect(validateFormLinkUrl("https://evil.example/form")).not.toBeNull();
      expect(validateFormLinkUrl("https://EVIL.EXAMPLE/form")).not.toBeNull();
    } finally {
      BLOCKED_FORM_LINK_HOSTS.delete("evil.example");
    }
  });
});
