import { describe, expect, it } from "vitest";
import {
  BankAccountSheetError,
  dedupeByAccount,
  findAccountConflicts,
  parseBankAccountSheet,
} from "../lib/bankAccountSheet";

describe("parseBankAccountSheet", () => {
  it("reads the ordinary sheet", () => {
    const sheet = parseBankAccountSheet([
      ["ลำดับ", "เลขสมาชิก", "ชื่อ-สกุล", "เลขบัญชี"],
      [1, "30051", "นางสาวสายธาร กะมะเริ", "413-1-57288-5"],
      [2, "30052", "นายสมชาย ใจดี", "4131572886"],
    ]);

    expect(sheet.rows).toEqual([
      {
        memberNumber: "30051",
        accountNumber: "4131572885",
        memberName: "นางสาวสายธาร กะมะเริ",
        rowNumber: 2,
      },
      {
        memberNumber: "30052",
        accountNumber: "4131572886",
        memberName: "นายสมชาย ใจดี",
        rowNumber: 3,
      },
    ]);
    expect(sheet.problems).toEqual([]);
  });

  it("finds the columns wherever they are, not where they were last time", () => {
    // Every one of these sheets is kept by hand and none of them agree on the
    // order. A fixed column index reads an ID card number as an account.
    const sheet = parseBankAccountSheet([
      ["ทะเบียนเลขบัญชีสมาชิก สหกรณ์ออมทรัพย์ครูหนองคาย จำกัด"],
      [],
      ["เลขที่บัญชี", "หน่วยงาน", "รหัสสมาชิก"],
      ["413-1-57288-5", "สพป.นค.1", "30051"],
    ]);

    expect(sheet.rows).toEqual([
      { memberNumber: "30051", accountNumber: "4131572885", memberName: null, rowNumber: 4 },
    ]);
  });

  it("matches a heading however it is spaced", () => {
    const sheet = parseBankAccountSheet([
      ["เลข สมาชิก", "เลขบัญชี ธนาคาร"],
      ["30051", "4131572885"],
    ]);
    expect(sheet.rows).toHaveLength(1);
  });

  it("refuses a file whose headings it cannot find, rather than guessing", () => {
    // Guessing here binds real money to the wrong person, silently.
    expect(() =>
      parseBankAccountSheet([
        ["A", "B", "C"],
        ["30051", "x", "4131572885"],
      ])
    ).toThrow(BankAccountSheetError);
  });

  it("does not mistake a data row far down the file for a header", () => {
    const rows: unknown[][] = Array.from({ length: 30 }, () => ["", ""]);
    rows[25] = ["เลขสมาชิก", "เลขบัญชี"];
    expect(() => parseBankAccountSheet(rows)).toThrow(BankAccountSheetError);
  });

  it("keeps a member number Excel handed back as a number", () => {
    const sheet = parseBankAccountSheet([
      ["เลขสมาชิก", "เลขบัญชี"],
      [30051, 4131572885],
    ]);
    expect(sheet.rows[0]).toMatchObject({ memberNumber: "30051", accountNumber: "4131572885" });
  });

  it("counts blank and spacer rows without calling them mistakes", () => {
    const sheet = parseBankAccountSheet([
      ["เลขสมาชิก", "เลขบัญชี"],
      ["30051", "4131572885"],
      [],
      ["", ""],
    ]);
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.blankRows).toBe(2);
    expect(sheet.problems).toEqual([]);
  });

  it("reports a half-filled row instead of skipping it", () => {
    // A member with no account is exactly the member staff are hunting for,
    // so a hole in the sheet is a finding, not something to swallow.
    const sheet = parseBankAccountSheet([
      ["เลขสมาชิก", "เลขบัญชี"],
      ["30051", ""],
      ["", "4131572885"],
      ["30053", "ยังไม่แจ้ง"],
    ]);

    expect(sheet.rows).toHaveLength(0);
    expect(sheet.problems.map((p) => p.rowNumber)).toEqual([2, 3, 4]);
    // Every message names the member or the account, because the row number
    // is only approximate — the reader drops empty rows before this sees them.
    expect(sheet.problems[0].reason).toContain("30051");
    expect(sheet.problems[1].reason).toContain("4131572885");
    expect(sheet.problems[2].reason).toContain("ยังไม่แจ้ง");
  });
});

describe("findAccountConflicts", () => {
  const row = (memberNumber: string, accountNumber: string, rowNumber = 1) => ({
    memberNumber,
    accountNumber,
    memberName: null,
    rowNumber,
  });

  it("catches one account claimed by two members", () => {
    // An account belongs to one person. Importing this would bind it to
    // whichever row happened to be last, silently.
    expect(findAccountConflicts([row("30051", "4131572885"), row("30052", "4131572885")])).toEqual([
      { accountNumber: "4131572885", memberNumbers: ["30051", "30052"] },
    ]);
  });

  it("says nothing about the same pair repeated", () => {
    expect(findAccountConflicts([row("30051", "4131572885"), row("30051", "4131572885")])).toEqual(
      []
    );
  });

  it("says nothing about one member with several accounts", () => {
    // That is normal and allowed — a member may pay from more than one.
    expect(findAccountConflicts([row("30051", "4131572885"), row("30051", "4131572886")])).toEqual(
      []
    );
  });
});

describe("dedupeByAccount", () => {
  it("keeps one row per account, the last one, as the upsert would", () => {
    const rows = [
      { memberNumber: "30051", accountNumber: "111", memberName: null, rowNumber: 2 },
      { memberNumber: "30051", accountNumber: "111", memberName: "ชื่อใหม่", rowNumber: 9 },
      { memberNumber: "30052", accountNumber: "222", memberName: null, rowNumber: 3 },
    ];
    const deduped = dedupeByAccount(rows);
    expect(deduped).toHaveLength(2);
    expect(deduped[0].rowNumber).toBe(9);
  });
});
