import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  checkUploadedFile,
  describeReadError,
  readFirstSheetRows,
} from "@/lib/excelUpload";
import { parseMaiDaiSheet } from "@/lib/statementReconcile";
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

  const form = await request.formData();
  const checked = checkUploadedFile(form.get("file"));
  if ("error" in checked) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  let rows: unknown[][];
  try {
    rows = await readFirstSheetRows(checked.file);
  } catch (err) {
    return NextResponse.json({ error: describeReadError(err) }, { status: 400 });
  }

  const sheet = parseMaiDaiSheet(rows);
  if (sheet.all.length === 0) {
    return NextResponse.json(
      {
        error:
          "ไม่พบรายชื่อสมาชิกในไฟล์นี้ — ตรวจว่าคอลัมน์ A เป็นเลขสมาชิก และ C เป็นยอดแจ้งหัก",
      },
      { status: 400 }
    );
  }

  const existing = await prisma.statementMember.findMany({
    where: { roundId: round.id },
    select: { memberNumber: true, deductionResult: true },
  });
  const plan = planDeductionUpload(existing, sheet.all);
  await applyRoundSheet(round.id, plan);
  const progress = await refreshRoundProgress(round.id);

  return NextResponse.json({
    added: plan.create.length,
    updated: plan.update.length,
    // Rows this file left as they were because the round already had an
    // answer for them — re-uploading a รายการหัก must not un-answer a unit
    // that has since replied.
    keptResult: plan.keptResult.length,
    untouched: plan.untouched,
    ...progress,
  });
}
