import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { cellText } from "../scripts/excelUtils";

function rowWithValues(values: unknown[]): ExcelJS.Row {
  const sheet = new ExcelJS.Workbook().addWorksheet("test");
  const row = sheet.addRow(values);
  return row;
}

describe("cellText", () => {
  it("returns the trimmed string for a normal value", () => {
    expect(cellText(rowWithValues(["  หน่วยงาน ก  "]), 1)).toBe("หน่วยงาน ก");
  });

  it("returns null for empty/undefined cells", () => {
    expect(cellText(rowWithValues([]), 1)).toBeNull();
    expect(cellText(rowWithValues([null]), 1)).toBeNull();
    expect(cellText(rowWithValues([""]), 1)).toBeNull();
  });

  it("treats the cooperative's own '-' placeholder as blank", () => {
    expect(cellText(rowWithValues(["-"]), 1)).toBeNull();
  });

  it("treats a literal 'nan' (any case) as blank — the pandas-export bug this fixes", () => {
    expect(cellText(rowWithValues(["nan"]), 1)).toBeNull();
    expect(cellText(rowWithValues(["NaN"]), 1)).toBeNull();
    expect(cellText(rowWithValues(["NAN"]), 1)).toBeNull();
    expect(cellText(rowWithValues(["  nan  "]), 1)).toBeNull();
  });

  it("treats other common blank tokens as blank", () => {
    expect(cellText(rowWithValues(["N/A"]), 1)).toBeNull();
    expect(cellText(rowWithValues(["null"]), 1)).toBeNull();
    expect(cellText(rowWithValues(["None"]), 1)).toBeNull();
  });

  it("does not treat a real unit name containing 'nan' as blank", () => {
    // Guard against over-matching: "nan" must match the *whole* trimmed
    // cell, not appear as a substring of a legitimate value.
    expect(cellText(rowWithValues(["บ้านนาโพธิ์"]), 1)).toBe("บ้านนาโพธิ์");
  });

  it("reads numeric cells as their string form", () => {
    expect(cellText(rowWithValues([12345]), 1)).toBe("12345");
  });
});
