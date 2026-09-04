import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { looksLikeLegacyXls, looksLikeZip, repairZip, toArrayBuffer } from "../lib/xlsxRepair";

// A real xlsx, built the same way the bank's export is: a zip of xml parts.
async function makeXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow(["เลขที่บัญชี", "จำนวนเงิน", "รายละเอียด"]);
  sheet.addRow(["4230123456", 5000, "TR fr 4230123456"]);
  sheet.addRow(["4230999999", 1250.5, "TR fr 4230999999"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// Cuts the file off at the central directory — exactly the damage the bank's
// exports arrive with, and what every zip reader refuses to open.
function stripCentralDirectory(data: Buffer): Buffer {
  const at = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  expect(at).toBeGreaterThan(0);
  return data.subarray(0, at);
}

async function firstSheetValues(data: Buffer): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(toArrayBuffer(data));
  const sheet = workbook.worksheets[0];
  const rows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    rows.push((row.values as unknown[]).slice(1));
  });
  return rows;
}

describe("looksLikeZip", () => {
  it("recognises a zip by its local file header", async () => {
    expect(looksLikeZip(await makeXlsx())).toBe(true);
  });

  it("rejects a file that only happens to be named .xls", () => {
    expect(looksLikeZip(Buffer.from("เลขที่บัญชี,จำนวนเงิน\n"))).toBe(false);
  });
});

describe("looksLikeLegacyXls", () => {
  it("recognises the OLE compound signature of a pre-2007 .xls", () => {
    const ole = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(512),
    ]);
    expect(looksLikeLegacyXls(ole)).toBe(true);
  });

  it("does not confuse a real xlsx for one", async () => {
    expect(looksLikeLegacyXls(await makeXlsx())).toBe(false);
  });
});

describe("repairZip", () => {
  it("makes a file with no central directory readable again", async () => {
    const broken = stripCentralDirectory(await makeXlsx());

    await expect(firstSheetValues(broken)).rejects.toThrow();

    const rows = await firstSheetValues(repairZip(broken));
    expect(rows[0]).toEqual(["เลขที่บัญชี", "จำนวนเงิน", "รายละเอียด"]);
    expect(rows[1]).toEqual(["4230123456", 5000, "TR fr 4230123456"]);
    expect(rows[2]).toEqual(["4230999999", 1250.5, "TR fr 4230999999"]);
  });

  it("leaves an undamaged file's contents alone", async () => {
    const rows = await firstSheetValues(repairZip(await makeXlsx()));
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual(["4230123456", 5000, "TR fr 4230123456"]);
  });

  it("keeps every entry, so no part of the workbook is dropped", async () => {
    const original = await makeXlsx();
    const names = (data: Buffer) => {
      const found: string[] = [];
      let pos = 0;
      for (;;) {
        const at = data.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), pos);
        if (at === -1) break;
        const nameLength = data.readUInt16LE(at + 26);
        found.push(data.subarray(at + 30, at + 30 + nameLength).toString("utf8"));
        pos = at + 4;
      }
      return found;
    };
    expect(names(repairZip(stripCentralDirectory(original)))).toEqual(names(original));
  });

  it("refuses a file that has no zip entries at all", () => {
    expect(() => repairZip(Buffer.from("not a spreadsheet"))).toThrow();
  });
});
