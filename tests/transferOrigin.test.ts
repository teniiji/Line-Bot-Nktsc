import { describe, expect, it } from "vitest";
import { transferOrigins, type OriginRow } from "../lib/transferOrigin";

const names: Record<string, string> = {
  "26418": "นายนิคม นามบุญมี",
  "26500": "นางสมศรี เจ้าของบัญชี",
};
const person = (memberNumber: string) => ({ memberNumber, name: names[memberNumber] ?? null });
const owners: Record<string, string> = { "4130013068": "26500", "4130017470": "26418" };
const accountOwner = (acct: string) => (owners[acct] ? person(owners[acct]) : null);

const row = (over: Partial<OriginRow> & { id: string }): OriginRow => ({
  fingerprint: over.id,
  memberNumber: "26500",
  accountNumber: "4130013068",
  amount: 4000,
  manualMemberNumber: false,
  ...over,
});

describe("transferOrigins", () => {
  it("names the account holder a whole transfer was moved from", () => {
    // 26418: ฿4,000 from 4130013068 — 26500's account — moved in whole.
    const info = transferOrigins(
      [row({ id: "t1", memberNumber: "26418", manualMemberNumber: true })],
      accountOwner,
      person
    ).get("t1");
    expect(info?.origin).toEqual({
      kind: "movedFrom",
      from: { memberNumber: "26500", name: "นางสมศรี เจ้าของบัญชี" },
    });
  });

  it("names the member a share was split from, and the whole transfer", () => {
    const rows = [
      row({ id: "p", fingerprint: "fp1", amount: 6000, manualMemberNumber: true }),
      row({ id: "c", fingerprint: "fp1::split:x", memberNumber: "26418", amount: 4000, manualMemberNumber: true }),
    ];
    const infos = transferOrigins(rows, accountOwner, person);
    expect(infos.get("c")?.origin).toEqual({
      kind: "splitFrom",
      from: { memberNumber: "26500", name: "นางสมศรี เจ้าของบัญชี" },
      total: 10000,
    });
    // The row it came off says where the share went, and is not itself
    // "moved here" — it is still the account holder's own money.
    expect(infos.get("p")).toEqual({
      origin: null,
      gaveTo: [{ memberNumber: "26418", name: "นายนิคม นามบุญมี", amount: 4000 }],
    });
  });

  it("says a row came from the daily page, naming the account's owner when it is someone else", () => {
    const infos = transferOrigins(
      [
        row({ id: "a", fingerprint: "line:1", memberNumber: "26418", manualMemberNumber: true }),
        row({ id: "b", fingerprint: "line:2", memberNumber: "26418", accountNumber: "4130017470", manualMemberNumber: true }),
      ],
      accountOwner,
      person
    );
    expect(infos.get("a")?.origin).toEqual({ kind: "recorded", accountOwner: person("26500") });
    expect(infos.get("b")?.origin).toEqual({ kind: "recorded", accountOwner: null });
  });

  it("says nothing about a transfer matched by its own account, or one whose owner nobody knows", () => {
    const infos = transferOrigins(
      [
        row({ id: "own", memberNumber: "26500" }),
        row({ id: "unknown", memberNumber: "26418", accountNumber: "999", manualMemberNumber: true }),
      ],
      accountOwner,
      person
    );
    expect(infos.has("own")).toBe(false);
    expect(infos.has("unknown")).toBe(false);
  });
});
