import { describe, expect, it } from "vitest";
import { looksLikeHtml, parseHtmlTableRows } from "../lib/htmlTable";

const buffer = (text: string) => Buffer.from(text, "utf8");

describe("looksLikeHtml", () => {
  it("recognises the bank's export by how it starts", () => {
    expect(looksLikeHtml(buffer('<html><head><meta charset="UTF-8"></head><body>'))).toBe(true);
    expect(looksLikeHtml(buffer("<!DOCTYPE html><html>"))).toBe(true);
    expect(looksLikeHtml(buffer("  \n<table><tr><td>x</td></tr></table>"))).toBe(true);
  });

  it("does not claim a real spreadsheet", () => {
    // A zip, and an OLE compound file — the other two shapes .xls arrives in.
    expect(looksLikeHtml(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))).toBe(false);
    expect(looksLikeHtml(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe(false);
  });

  it("is not fooled by a spreadsheet that merely contains markup further in", () => {
    const zipWithHtmlInside = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("...<html> appearing inside a cell somewhere..."),
    ]);
    expect(looksLikeHtml(zipWithHtmlInside)).toBe(false);
  });
});

describe("parseHtmlTableRows", () => {
  it("reads a statement row into the same columns the spreadsheet has", () => {
    const rows = parseHtmlTableRows(`
      <table><tr>
        <td valign='top'>01-08-2026 10:22:09</td>
        <td valign='top'>AB0011</td>
        <td valign='top'>IORSDT</td>
        <td valign='top'>011-9217989020</td>
        <td align='right'></td>
        <td align='right'>15,570.00</td>
        <td valign='top'></td>
        <td valign='top'>116,948,986.54</td>
        <td valign='top'>0413</td>
      </tr></table>`);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual([
      "01-08-2026 10:22:09",
      "AB0011",
      "IORSDT",
      "011-9217989020",
      null,
      "15,570.00",
      null,
      "116,948,986.54",
      "0413",
    ]);
  });

  it("holds a spanned cell's columns open so nothing shifts left", () => {
    const rows = parseHtmlTableRows(
      `<tr><td>Account No.</td><td>413-1-00127-6</td><td colspan='2'>&nbsp;</td><td>ท้ายแถว</td></tr>`
    );
    // The bank uses &nbsp; as a spacer, so it reads as an empty cell —
    // the same as a blank one in the spreadsheet version.
    expect(rows[0]).toEqual(["Account No.", "413-1-00127-6", null, null, "ท้ายแถว"]);
    // The last value must still be at index 4, where the spreadsheet has it.
    expect(rows[0][4]).toBe("ท้ายแถว");
  });

  it("reads both of the bank's sibling tables, in order", () => {
    // The account header and the transactions are separate tables; the
    // parsers downstream expect them one after the other.
    const rows = parseHtmlTableRows(`
      <table><tr><td>Account No.</td><td>413-1-00127-6</td></tr></table>
      <table><tr><td>Date</td><td>Amount</td></tr>
             <tr><td>01-08-2026</td><td>500.00</td></tr></table>`);
    expect(rows.map((r) => r[0])).toEqual(["Account No.", "Date", "01-08-2026"]);
  });

  it("decodes the entities the export actually uses", () => {
    const rows = parseHtmlTableRows(
      "<tr><td>&nbsp;</td><td>A&amp;B</td><td>&#3585;</td><td>&lt;ไม่ใช่แท็ก&gt;</td></tr>"
    );
    expect(rows[0]).toEqual([null, "A&B", "ก", "<ไม่ใช่แท็ก>"]);
  });

  it("keeps Thai text intact", () => {
    const rows = parseHtmlTableRows(
      "<tr><td>สหกรณ์ออมทรัพย์ครูหนองคาย จำกัด</td><td>นาง ไพบูลย์ พนาลิกุล</td></tr>"
    );
    expect(rows[0]).toEqual(["สหกรณ์ออมทรัพย์ครูหนองคาย จำกัด", "นาง ไพบูลย์ พนาลิกุล"]);
  });

  it("treats a line break inside a cell as a space, not a join", () => {
    const rows = parseHtmlTableRows("<tr><td>TR fr<br/>4131572885</td></tr>");
    expect(rows[0][0]).toBe("TR fr 4131572885");
  });

  it("strips markup inside a cell", () => {
    const rows = parseHtmlTableRows("<tr><td><span style='x'><b>5,000.00</b></span></td></tr>");
    expect(rows[0][0]).toBe("5,000.00");
  });

  it("gives an empty cell null, the way a blank spreadsheet cell reads", () => {
    const rows = parseHtmlTableRows("<tr><td></td><td>   </td><td>x</td></tr>");
    expect(rows[0]).toEqual([null, null, "x"]);
  });

  it("returns nothing for a document with no table in it", () => {
    expect(parseHtmlTableRows("<html><body><p>ไม่มีตาราง</p></body></html>")).toEqual([]);
  });
});
