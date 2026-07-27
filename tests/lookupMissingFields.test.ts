import { describe, expect, it } from "vitest";
import { computeLookupMissingFields } from "../lib/agent/state";

describe("computeLookupMissingFields", () => {
  it("returns all three when nothing is filled", () => {
    expect(computeLookupMissingFields({ fullName: null, nationalId: null, phone: null })).toEqual([
      "full_name",
      "national_id",
      "phone",
    ]);
  });

  it("returns only the missing ones when some are already filled", () => {
    expect(
      computeLookupMissingFields({ fullName: "สมชาย ใจดี", nationalId: null, phone: null })
    ).toEqual(["national_id", "phone"]);
  });

  it("returns an empty array once all three are filled", () => {
    expect(
      computeLookupMissingFields({
        fullName: "สมชาย ใจดี",
        nationalId: "1100400618858",
        phone: "0812345678",
      })
    ).toEqual([]);
  });
});
