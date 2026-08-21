import { describe, expect, it } from "vitest";
import { checkBasicAuth } from "../lib/basicAuth";

// Build a "Basic <base64>" header the way a browser does: UTF-8 encode
// "user:password", then base64 it. btoa can't do this for non-ASCII, which
// is exactly the bug checkBasicAuth fixes — so encode via bytes here.
function basicHeader(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "Basic " + btoa(bin);
}

describe("checkBasicAuth", () => {
  it("accepts a correct ASCII credential pair", () => {
    expect(checkBasicAuth(basicHeader("staff", "s3cret"), "staff", "s3cret")).toBe(
      true
    );
  });

  it("accepts a non-ASCII (Thai) password — the btoa bug this fixes", () => {
    const pw = "รหัสผ่านภาษาไทย";
    expect(checkBasicAuth(basicHeader("staff", pw), "staff", pw)).toBe(true);
  });

  it("rejects a wrong password without throwing", () => {
    expect(checkBasicAuth(basicHeader("staff", "wrong"), "staff", "s3cret")).toBe(
      false
    );
  });

  it("rejects a wrong user", () => {
    expect(checkBasicAuth(basicHeader("intruder", "s3cret"), "staff", "s3cret")).toBe(
      false
    );
  });

  it("preserves colons inside the password", () => {
    const pw = "a:b:c";
    expect(checkBasicAuth(basicHeader("staff", pw), "staff", pw)).toBe(true);
  });

  it("rejects a missing or non-Basic header", () => {
    expect(checkBasicAuth("", "staff", "s3cret")).toBe(false);
    expect(checkBasicAuth("Bearer token", "staff", "s3cret")).toBe(false);
    expect(checkBasicAuth("Basic ", "staff", "s3cret")).toBe(false);
  });

  it("rejects malformed base64 without throwing", () => {
    expect(checkBasicAuth("Basic !!!not-base64!!!", "staff", "s3cret")).toBe(false);
  });

  it("rejects a decoded value with no colon separator", () => {
    expect(checkBasicAuth("Basic " + btoa("nocolon"), "staff", "s3cret")).toBe(
      false
    );
  });

  // Exercises constantTimeEqual's length-mismatch branch specifically —
  // it folds a.length ^ b.length into the result instead of relying on
  // the max-length loop alone, so a strict prefix or a too-long guess
  // must still be rejected rather than accidentally short-circuiting true.
  it("rejects a password that's a strict prefix of the real one", () => {
    expect(checkBasicAuth(basicHeader("staff", "s3cr"), "staff", "s3cret")).toBe(
      false
    );
  });

  it("rejects a password that's the real one plus extra characters", () => {
    expect(
      checkBasicAuth(basicHeader("staff", "s3cretx"), "staff", "s3cret")
    ).toBe(false);
  });

  it("rejects an empty password against a non-empty one", () => {
    expect(checkBasicAuth(basicHeader("staff", ""), "staff", "s3cret")).toBe(
      false
    );
  });
});
