import { describe, expect, it } from "vitest";
import { bankFromDescription, bankNameFromCode } from "../lib/thaiBanks";
import { extractSenderAccount } from "../lib/statementLines";

describe("bankFromDescription", () => {
  it("names the bank on the lines this exists for", () => {
    // All three are real counter deposits off the daily tab.
    expect(bankFromDescription("014-8592630385")).toEqual({ code: "014", name: "ไทยพาณิชย์" });
    expect(bankFromDescription("004-0323265518")).toEqual({ code: "004", name: "กสิกรไทย" });
    expect(bankFromDescription("025-2021614212")).toEqual({ code: "025", name: "กรุงศรีอยุธยา" });
  });

  it("still names it when the bank appended its own note", () => {
    // The bank writes things like "Future Amount: 1500 Tran" after the
    // account, and the prefix is still the prefix.
    expect(bankFromDescription("014-8872614889 Future Amount: 1500 Tran")?.name).toBe(
      "ไทยพาณิชย์"
    );
  });

  it("says nothing about a transfer line, which carries no bank code", () => {
    expect(bankFromDescription("TR fr 4131579286")).toBeNull();
  });

  it("says nothing rather than guessing at a code it does not know", () => {
    // Half the value of the label is that it can be trusted. There is no
    // version of "probably ธนาคารกรุงเทพ" worth printing beside somebody's
    // money.
    expect(bankFromDescription("999-1234567890")).toBeNull();
  });

  it("does not read a longer prefix as a bank code", () => {
    // extractSenderAccount accepts three to six digits there, because some
    // lines carry something longer that is not a bank code. Four digits is
    // not one, so it gets no name.
    expect(bankFromDescription("0140-8592630385")).toBeNull();
    expect(bankFromDescription("010753700088205-BU0994005S00999915K")).toBeNull();
  });

  it("ignores a name-only description", () => {
    // A cheque line carries the payer's name and nothing else.
    expect(bankFromDescription("นายโชติช่วง คำสังทาร")).toBeNull();
    expect(bankFromDescription("")).toBeNull();
  });

  it("agrees with the parser about where the account starts", () => {
    // The two read the same string for different reasons, and a change to
    // either that moved the boundary would be a silent disagreement.
    const line = "014-8592630385";
    expect(bankFromDescription(line)?.code).toBe("014");
    expect(extractSenderAccount(line)).toBe("8592630385");
  });
});

describe("bankNameFromCode", () => {
  it("knows the banks members actually pay from", () => {
    for (const [code, name] of [
      ["002", "กรุงเทพ"],
      ["004", "กสิกรไทย"],
      ["006", "กรุงไทย"],
      ["014", "ไทยพาณิชย์"],
      ["025", "กรุงศรีอยุธยา"],
      ["030", "ออมสิน"],
      ["034", "ธ.ก.ส."],
    ] as const) {
      expect(bankNameFromCode(code), code).toBe(name);
    }
  });

  it("returns nothing for a code it does not carry", () => {
    expect(bankNameFromCode("999")).toBeNull();
    expect(bankNameFromCode("")).toBeNull();
  });
});
