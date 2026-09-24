import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ROUND_CLOSED_ERROR } from "@/lib/carriedDebt";
import {
  checkUploadedFile,
  describeReadError,
  readFirstSheetRows,
} from "@/lib/excelUpload";
import { detectSheetColumns } from "@/lib/sheetColumns";
import { readMappedSheet } from "@/lib/mappedSheet";
import { parseConfirmedUpload } from "@/lib/uploadMapping";
import { planDeductionUpload } from "@/lib/deductionUpload";
import { applyRoundSheet, refreshRoundProgress } from "@/lib/roundMembers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Starts a round from the รายการหัก — the list payroll was asked to deduct —
// rather than from the results that come back weeks later.
//
// The round then knows its own population from the first day of the month:
// every member, what they were to be deducted, and which units have not
// replied. Before this, a unit that never sent its file left no trace at all,
// because the only record of who was supposed to be on the list was the
// consolidated sheet somebody had not finished assembling.
//
// Uploads merge rather than replace, so the whole cooperative's list can go
// in at once or one เขต at a time as the files are produced, and a corrected
// file can be sent again without taking the rest of the round away. A row
// with no result never overwrites one that has a result — see
// lib/deductionUpload.ts.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const round = await prisma.statementRound.findUnique({ where: { id: params.id } });
  if (!round) {
    return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });
  }
  if (round.closedAt) {
    return NextResponse.json({ error: ROUND_CLOSED_ERROR }, { status: 409 });
  }

  const form = await request.formData();
  const checked = checkUploadedFile(form.get("file"));
  if ("error" in checked) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  const sheetRaw = Number(form.get("sheet"));
  const sheetIndex = Number.isInteger(sheetRaw) && sheetRaw >= 0 ? sheetRaw : 0;

  let rows: unknown[][];
  try {
    rows = await readFirstSheetRows(checked.file, sheetIndex);
  } catch (err) {
    return NextResponse.json({ error: describeReadError(err) }, { status: 400 });
  }

  // The mapping the person confirmed in the preview. Without one — an older
  // page, or a call from somewhere else — the sheet is read again the same
  // way the preview read it.
  const confirmed = parseConfirmedUpload(form.get("mapping"), form.get("firstDataRow"));
  const reading = confirmed ?? detectSheetColumns(rows);
  const sheet = readMappedSheet(rows, reading.firstDataRow, reading.mapping);

  if (sheet.rows.length === 0) {
    return NextResponse.json(
      {
        error:
          "ไม่พบรายชื่อสมาชิกในไฟล์นี้ — ตรวจว่าเลือกคอลัมน์เลขสมาชิกถูกต้อง แล้วลองใหม่",
      },
      { status: 400 }
    );
  }

  const existing = await prisma.statementMember.findMany({
    where: { roundId: round.id },
    select: { memberNumber: true, deductionResult: true, hCode: true },
  });
  // Only a sheet that keeps the หน่วยคุม and the รหัสสังกัด in separate
  // columns knows the difference between them — see UploadOptions.
  const plan = planDeductionUpload(existing, sheet.rows, {
    unitsAreAuthoritative:
      reading.mapping.hCode !== undefined && reading.mapping.unitCode !== undefined,
  });
  const filled = await applyRoundSheet(round.id, plan);
  const progress = await refreshRoundProgress(round.id);

  return NextResponse.json({
    added: plan.create.length,
    updated: plan.update.length,
    // Rows in the file with no member number in the mapped column: blank
    // lines, a total at the foot of a unit's sheet. Said out loud, because a
    // mapping pointed at the wrong column reads as a file half imported.
    skippedRows: sheet.skipped,
    // Rows this file left as they were because the round already had an
    // answer for them — re-uploading a รายการหัก must not un-answer a unit
    // that has since replied.
    keptResult: plan.keptResult.length,
    // Rows whose หน่วยคุม this file was not entitled to change, because it
    // does not tell a หน่วยคุม from a รหัสสังกัด.
    keptUnit: plan.keptUnit,
    untouched: plan.untouched,
    filledFromDirectory: filled.fromDirectory,
    filledFromPrevious: filled.fromPrevious,
    ambiguousAccounts: filled.ambiguous,
    ...progress,
  });
}
