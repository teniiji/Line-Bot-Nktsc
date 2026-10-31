import { describe, expect, it } from "vitest";
import { debitAccountsToKeep, parseDebitPaste } from "../lib/debitPaste";

describe("a Direct Debit list pasted into a division", () => {
  it("reads the sending file copied from Excel: name, account, amount", () => {
    const text = [
      "นางสิริเกศ  คิสาลัง\t4300009414\t2500",
      "น.ส.แวววลี  วงค์คำจันทร์\t4300208417\t6500",
      "นายพินิจ  งามวิเศษ  \t4130007033\t15000",
    ].join("\n");
    expect(parseDebitPaste(text)).toEqual({
      rows: [
        { account: "4300009414", amount: 2500, name: "นางสิริเกศ คิสาลัง" },
        { account: "4300208417", amount: 6500, name: "น.ส.แวววลี วงค์คำจันทร์" },
        { account: "4130007033", amount: 15000, name: "นายพินิจ งามวิเศษ" },
      ],
      skipped: 0,
    });
  });

  it("reads the bank's CTF001 report, taking Tr. Amt over the service code and fee", () => {
    const text = [
      "Item Bank-Branch Account No PromptPay Account Name Srv Type System Ref. No. Tr. Amt Approve.Amt FeeAmt NetAmt",
      "1 006-0413 2951160968 นายโกเมน โปตะวัฒน์ 14 D Direct Debit นายโกเมน โปตะวัฒน์ 4,000.00 4,000.00 10.00 4,010.00",
      "8 006-0413 4130019163 นาง จิริยา รัตนกันทร 14 D Direct Debit นางจิริยา รัตนกันทรพิบูล 23,000.00 23,000.00 10.00 23,010.00",
      "10 75,000.00 75,000.00 100.00 75,100.00",
    ].join("\n");
    const read = parseDebitPaste(text);
    expect(read.rows.map((r) => [r.account, r.amount])).toEqual([
      ["2951160968", 4000],
      ["4130019163", 23000],
    ]);
    expect(read.rows[0].name).toBe("นายโกเมน โปตะวัฒน์");
    expect(read.skipped).toBe(2);
  });

  it("reads an account written with dashes, and the amount in Excel's money format", () => {
    expect(parseDebitPaste("413-0-00399-2\tนายวีระศักดิ์ ชัยภิบาล\t4,000.00").rows).toEqual([
      { account: "4130003992", amount: 4000, name: "นายวีระศักดิ์ ชัยภิบาล" },
    ]);
  });

  it("does not take a national ID for an account", () => {
    expect(parseDebitPaste("นายมงคล\t3430100453695\t1340").rows).toEqual([]);
  });

  it("skips a row with an account but no amount", () => {
    expect(parseDebitPaste("นายมงคล\t4130003992").skipped).toBe(1);
  });
});

describe("which accounts a saved division teaches", () => {
  const parts = [{ memberNumber: "25686" }, { memberNumber: "026127" }];

  it("keeps accounts of members the division paid, by member key", () => {
    expect(
      debitAccountsToKeep(
        [
          { account: "9851946753", memberNumber: "25686" },
          { account: "4300009414", memberNumber: "26127" },
        ],
        parts
      )
    ).toEqual(
      new Map([
        ["9851946753", "25686"],
        ["4300009414", "26127"],
      ])
    );
  });

  it("leaves out a member removed from the division after the paste", () => {
    expect(debitAccountsToKeep([{ account: "4131173352", memberNumber: "11111" }], parts).size).toBe(0);
  });

  it("leaves out a member number that is not digits", () => {
    expect(
      debitAccountsToKeep([{ account: "9851946753", memberNumber: "25686 นางพิศวง" }], [
        { memberNumber: "25686 นางพิศวง" },
      ]).size
    ).toBe(0);
  });

  it("keeps the first member named for an account", () => {
    expect(
      debitAccountsToKeep(
        [
          { account: "9851946753", memberNumber: "25686" },
          { account: "985-1946753", memberNumber: "26127" },
        ],
        parts
      )
    ).toEqual(new Map([["9851946753", "25686"]]));
  });
});
