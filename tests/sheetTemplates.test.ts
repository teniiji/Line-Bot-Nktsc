import { describe, expect, it } from "vitest";
import {
  BANK_ACCOUNT_TEMPLATE,
  MEMBER_ROSTER_TEMPLATE,
  templateRows,
} from "../lib/sheetTemplates";
import { parseMemberRosterSheet } from "../lib/memberRosterSheet";
import { findAccountConflicts, parseBankAccountSheet } from "../lib/bankAccountSheet";
import { findMemberConflicts } from "../lib/memberRosterSheet";

// The point of every assertion below: a template that has stopped importing
// is worse than no template, and nothing about editing a heading in one file
// would otherwise reveal that the other file no longer reads it.

describe("the member roster template", () => {
  const rows = templateRows(MEMBER_ROSTER_TEMPLATE);

  it("imports through the parser it was written for", () => {
    const sheet = parseMemberRosterSheet(rows);
    expect(sheet.rows).toHaveLength(MEMBER_ROSTER_TEMPLATE.examples.length);
    expect(sheet.problems).toHaveLength(0);
  });

  it("carries every optional column, so the file shows what can be filled in", () => {
    // Somebody starting from nothing types what the template offers. A column
    // it omits is a column they will never know exists.
    expect(parseMemberRosterSheet(rows).columns).toEqual({
      unit: true,
      nationalId: true,
      phone: true,
      account: true,
    });
  });

  it("reads back exactly the values it was given", () => {
    const sheet = parseMemberRosterSheet(rows);
    expect(sheet.rows[0]).toMatchObject({
      memberNumber: "10152",
      unitName: "บำนาญ อ.เมือง นค.",
      nationalId: "3430100128262",
      phone: "0807597560",
    });
  });

  it("puts the instruction above the header, where it is skipped not read", () => {
    // Inside the header row it would become a column; below it, a data row.
    expect(rows[0]).toEqual([MEMBER_ROSTER_TEMPLATE.note]);
    expect(parseMemberRosterSheet(rows).blankRows).toBe(0);
  });

  it("marks its example rows as examples", () => {
    // If one ever survives into a real import it is recognisable on the
    // screen rather than filed as a member.
    for (const example of MEMBER_ROSTER_TEMPLATE.examples) {
      expect(example[1]).toContain("ตัวอย่าง");
    }
  });

  it("does not itself contain the duplicate that would refuse the import", () => {
    expect(findMemberConflicts(parseMemberRosterSheet(rows).rows)).toHaveLength(0);
  });

  it("has a width for every column", () => {
    expect(MEMBER_ROSTER_TEMPLATE.widths).toHaveLength(MEMBER_ROSTER_TEMPLATE.header.length);
  });
});

describe("the bank account template", () => {
  const rows = templateRows(BANK_ACCOUNT_TEMPLATE);

  it("imports through the parser it was written for", () => {
    const sheet = parseBankAccountSheet(rows);
    expect(sheet.rows).toHaveLength(BANK_ACCOUNT_TEMPLATE.examples.length);
    expect(sheet.problems).toHaveLength(0);
  });

  it("shows both ways of writing an account number, and both survive", () => {
    // The file says punctuation is optional; this is that claim, checked.
    const sheet = parseBankAccountSheet(rows);
    expect(BANK_ACCOUNT_TEMPLATE.examples[0][2]).toContain("-");
    expect(BANK_ACCOUNT_TEMPLATE.examples[1][2]).not.toContain("-");
    expect(sheet.rows[0].accountNumber).toBe("9825072199");
    expect(sheet.rows[1].accountNumber).toBe("9825072188");
  });

  it("gives the two example rows different accounts", () => {
    // The same account under two members is the one thing that refuses the
    // whole file — the template must not be an example of it.
    expect(findAccountConflicts(parseBankAccountSheet(rows).rows)).toHaveLength(0);
  });

  it("picks up the optional name column", () => {
    expect(parseBankAccountSheet(rows).rows[0].memberName).toContain("นิพนธ์");
  });

  it("puts the instruction above the header", () => {
    expect(rows[0]).toEqual([BANK_ACCOUNT_TEMPLATE.note]);
    expect(parseBankAccountSheet(rows).blankRows).toBe(0);
  });

  it("has a width for every column", () => {
    expect(BANK_ACCOUNT_TEMPLATE.widths).toHaveLength(BANK_ACCOUNT_TEMPLATE.header.length);
  });
});

describe("both templates", () => {
  it("are offered as .xlsx, which is what the importers accept", () => {
    // A template you cannot feed back in is a worked example, not a template.
    expect(MEMBER_ROSTER_TEMPLATE.fileName.endsWith(".xlsx")).toBe(true);
    expect(BANK_ACCOUNT_TEMPLATE.fileName.endsWith(".xlsx")).toBe(true);
  });

  it("tell the reader to delete the example rows", () => {
    for (const template of [MEMBER_ROSTER_TEMPLATE, BANK_ACCOUNT_TEMPLATE]) {
      expect(template.note).toContain("ลบแถวตัวอย่าง");
      expect(template.note).toContain("หัวตารางห้ามแก้");
    }
  });
});
