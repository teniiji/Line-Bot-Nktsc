import { describe, expect, it } from "vitest";
import { maskNationalId } from "../lib/memberPrivacy";

describe("maskNationalId", () => {
  it("keeps the last four digits and hides the rest", () => {
    // Four is what a person checks against the card in front of them.
    expect(maskNationalId("3430100123456")).toBe("xxxxxxxxx3456");
  });

  it("keeps the length, so a wrong-length value is still visible as one", () => {
    expect(maskNationalId("3430100123456")).toHaveLength(13);
    expect(maskNationalId("12345")).toHaveLength(5);
  });

  it("hides a value too short to be a national ID completely", () => {
    // Showing the last four of a four-digit value would reveal all of it.
    expect(maskNationalId("1234")).toBe("xxxx");
    expect(maskNationalId("12")).toBe("xx");
  });

  it("says nothing rather than masking nothing", () => {
    // A member with no ID on file must not render as a row of x's, which
    // would read as "recorded but hidden".
    expect(maskNationalId(null)).toBeNull();
    expect(maskNationalId(undefined)).toBeNull();
    expect(maskNationalId("")).toBeNull();
    expect(maskNationalId("   ")).toBeNull();
  });

  it("never returns any digit but the last four", () => {
    // The property the whole thing rests on: no leading digit survives.
    const masked = maskNationalId("3430100123456") ?? "";
    expect(masked.slice(0, -4)).toMatch(/^x+$/);
    expect(masked).not.toContain("343010");
  });
});
