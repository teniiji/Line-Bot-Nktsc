import { NextRequest, NextResponse } from "next/server";
import {
  checkUploadedFile,
  describeReadError,
  listSheets,
  readFirstSheetRows,
} from "@/lib/excelUpload";
import { columnSamples, detectSheetColumns } from "@/lib/sheetColumns";
import { readMappedSheet } from "@/lib/mappedSheet";
import { parseConfirmedUpload } from "@/lib/uploadMapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reads an uploaded sheet and says what it thinks each column is, without
// writing anything.
//
// Every เขต builds its own file and no two agree — one has two banner rows, a
// header, and a ลำดับ column before the member number; another has no header
// at all and puts the national ID where an account number would be. Read by
// fixed position, the second kind imported ยอดหักได้ as ยอดหักไม่ได้ and put
// a whole district of people who had paid in full into the chase list, for
// ฿12,243,006. Nothing about the screen said so.
//
// So the file is read once here, the reading is shown beside the first rows
// it produced, and a person confirms or corrects it before any of it is
// saved. The same mapping then goes back with the real upload.
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const checked = checkUploadedFile(form.get("file"));
  if ("error" in checked) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  // Which page of the workbook to read. A unit's file carries "หน่วย" beside
  // "สรุป", and the results are not always on the first one.
  const sheetRaw = Number(form.get("sheet"));
  const sheetIndex = Number.isInteger(sheetRaw) && sheetRaw >= 0 ? sheetRaw : 0;

  let sheets;
  let rows: unknown[][];
  try {
    sheets = await listSheets(checked.file);
    rows = await readFirstSheetRows(checked.file, sheetIndex);
  } catch (err) {
    return NextResponse.json({ error: describeReadError(err) }, { status: 400 });
  }
  if (rows.length === 0) {
    return NextResponse.json(
      {
        error:
          sheets.length > 1
            ? `ชีต "${sheets[sheetIndex]?.name ?? sheetIndex + 1}" ไม่มีข้อมูล — ลองเลือกชีตอื่นในไฟล์นี้`
            : "ไฟล์นี้ไม่มีข้อมูลในชีตแรก",
        sheets,
        sheetIndex,
      },
      { status: 400 }
    );
  }

  // Asked again with a corrected mapping while the dialog is open, so the
  // preview shown is always the reading that would be saved — a table that
  // kept showing the first guess after somebody changed a column would be
  // worse than no preview at all.
  const corrected = parseConfirmedUpload(form.get("mapping"), form.get("firstDataRow"));
  const detected = detectSheetColumns(rows);
  const reading = corrected
    ? { ...detected, ...corrected, fromHeader: detected.fromHeader }
    : detected;
  const read = readMappedSheet(rows, reading.firstDataRow, reading.mapping);

  return NextResponse.json({
    sheets,
    sheetIndex,
    headerRow: reading.headerRow,
    firstDataRow: reading.firstDataRow,
    mapping: reading.mapping,
    fromHeader: reading.fromHeader,
    columns: columnSamples(rows, reading),
    totalRows: rows.length,
    // What this reading would import, so the numbers can be sanity-checked
    // against the unit's own summary before anything is written.
    counts: {
      members: read.rows.length,
      skipped: read.skipped,
      awaiting: read.awaiting,
      collected: read.collected,
      uncollected: read.uncollected,
      uncollectedAmount:
        Math.round(read.rows.reduce((sum, row) => sum + row.amountDue, 0) * 100) / 100,
    },
    preview: read.rows.slice(0, 5),
  });
}
