import type { SheetMapping } from "@/lib/sheetColumns";

// Which page of a workbook holds the deduction results.
//
// A unit's file is often its list on page one and the outcome on a page
// after it — บำนาญหน่วยงานกลาง sends "1" (เลขที่, ชื่อ, แจ้งหัก, รวม) and
// then "ไม่ได้" with the same people and หักได้/หักไม่ได้ beside them. Read
// from page one, the upload found no result columns, recorded nobody as
// anything, and every member stayed "รอผลการหัก" with the file listed as
// uploaded. Nothing on the screen said the results had been on page two.

export interface SheetReadingSummary {
  index: number;
  mapping: SheetMapping;
}

export function hasResultColumns(mapping: SheetMapping): boolean {
  return (
    mapping.memberNumber !== undefined &&
    (mapping.collected !== undefined || mapping.uncollected !== undefined)
  );
}

// The pages a results upload could be read from, in workbook order.
export function sheetsWithResults(readings: SheetReadingSummary[]): number[] {
  return readings.filter((reading) => hasResultColumns(reading.mapping)).map((r) => r.index);
}

// Page one when it has results, otherwise the first page that does. A
// workbook with none keeps page one, and the dialog says why that will not
// record anything.
export function chooseResultSheet(readings: SheetReadingSummary[]): number {
  const found = sheetsWithResults(readings);
  if (found.length === 0 || found.includes(0)) return 0;
  return found[0];
}

export interface ResultSheetNote {
  tone: "info" | "warn";
  text: string;
}

export function resultSheetNote({
  sheets,
  sheetIndex,
  mapping,
  resultSheets,
  autoPicked,
}: {
  sheets: { index: number; name: string }[];
  sheetIndex: number;
  mapping: SheetMapping;
  resultSheets: number[];
  autoPicked: boolean;
}): ResultSheetNote | null {
  const nameOf = (index: number) => `"${sheets.find((s) => s.index === index)?.name ?? index + 1}"`;

  if (!hasResultColumns(mapping)) {
    const elsewhere = resultSheets.filter((index) => index !== sheetIndex);
    const where =
      elsewhere.length > 0
        ? `ผลการหักอยู่ที่ชีต ${elsewhere.map(nameOf).join(", ")} — เลือกชีตด้านบน`
        : "ถ้าผลอยู่ในคอลัมน์อื่น เลือกช่องยอดหักได้/ยอดหักไม่ได้ด้านล่าง";
    return {
      tone: "warn",
      text: `ชีต ${nameOf(sheetIndex)} ไม่มีคอลัมน์หักได้/หักไม่ได้ — นำเข้าแบบนี้ทุกคนในไฟล์จะยังเป็น "รอผลการหัก" · ${where}`,
    };
  }

  if (autoPicked && sheetIndex !== 0) {
    return {
      tone: "info",
      text: `เลือกชีต ${nameOf(sheetIndex)} ให้อัตโนมัติ เพราะชีตแรก ${nameOf(0)} ไม่มีคอลัมน์หักได้/หักไม่ได้`,
    };
  }
  return null;
}
