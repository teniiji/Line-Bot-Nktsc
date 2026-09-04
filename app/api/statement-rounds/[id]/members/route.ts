import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  checkUploadedFile,
  readFirstSheetRows,
  UNREADABLE_FILE_ERROR,
} from "@/lib/excelUpload";
import { parseMaiDaiSheet } from "@/lib/statementReconcile";
import {
  applyDirectoryAccounts,
  recomputeRoundPayments,
  rematchRoundTransfers,
} from "@/lib/statementRecompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Takes the round's "รวม_ไม่ได้" sheet — the members payroll could not
// deduct from — and makes it this round's list.
//
// Re-uploading replaces the list rather than merging into it: the sheet is
// regenerated locally whenever the หักไม่ได้ analysis is re-run, and a merge
// would leave members who dropped off the corrected sheet sitting in the
// round forever. Transfers already read out of statements survive the
// replacement and are re-matched against the new list, so correcting the
// sheet never costs the reconciliation work already done.
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
  } catch {
    return NextResponse.json({ error: UNREADABLE_FILE_ERROR }, { status: 400 });
  }

  const sheet = parseMaiDaiSheet(rows);
  const parsed = sheet.rows;
  if (parsed.length === 0) {
    // A sheet where every unit is still awaiting its result is a real case,
    // and saying "ไม่พบรายชื่อ" for it would send staff hunting for a problem
    // with the file that is not there.
    if (sheet.awaitingMembers > 0) {
      return NextResponse.json(
        {
          error:
            `ไฟล์นี้ยังไม่มีผลการหักเลยสักหน่วย (${sheet.awaitingMembers} คนรอผลอยู่) — ` +
            `รอให้หน่วยงานส่งผลกลับมาก่อนแล้วค่อยอัปโหลดใหม่`,
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        error:
          "ไม่พบรายชื่อหักไม่ได้ในไฟล์นี้ — ตรวจว่าเป็นไฟล์ \"รวม_ไม่ได้\" ที่คอลัมน์ E เป็นยอดหักไม่ได้",
      },
      { status: 400 }
    );
  }

  await prisma.$transaction([
    prisma.statementMember.deleteMany({ where: { roundId: round.id } }),
    prisma.statementMember.createMany({
      data: parsed.map((row) => ({
        roundId: round.id,
        memberNumber: row.memberNumber,
        name: row.name,
        unitName: row.unitName,
        hCode: row.hCode,
        note: row.note,
        accountNumber: row.accountNumber,
        amountDue: row.amountDue,
      })),
      skipDuplicates: true,
    }),
  ]);

  // What the sheet had no result for is recorded on the round so the warning
  // survives a page refresh — it is a property of this round's data, not a
  // one-off message about this upload.
  await prisma.statementRound.update({
    where: { id: round.id },
    data: {
      awaitingUnits: sheet.awaitingUnits.length,
      awaitingMembers: sheet.awaitingMembers,
      awaitingAmount: sheet.awaitingAmount,
    },
  });

  // Members the sheet left without an account number may already be known to
  // the directory from an earlier round, so filling those in first means the
  // work of binding accounts is not repeated every month.
  const filledFromDirectory = await applyDirectoryAccounts(round.id);

  // Statements already uploaded for this round keep their transfers, so a
  // corrected member list re-reconciles against them instead of making staff
  // upload every statement again.
  await rematchRoundTransfers(round.id);
  await recomputeRoundPayments(round.id);

  const imported = await prisma.statementMember.count({ where: { roundId: round.id } });
  // Counted after the directory has had its say, so this is the members
  // genuinely left unmatchable rather than everyone the sheet left blank.
  const missingAccount = await prisma.statementMember.count({
    where: { roundId: round.id, accountNumber: null },
  });
  return NextResponse.json({
    imported,
    // Members with no account number can never be matched to a transfer, so
    // staff need to know up front rather than wondering why they stay ❌.
    missingAccount,
    filledFromDirectory,
    awaitingUnits: sheet.awaitingUnits.length,
    awaitingMembers: sheet.awaitingMembers,
    awaitingAmount: sheet.awaitingAmount,
  });
}
