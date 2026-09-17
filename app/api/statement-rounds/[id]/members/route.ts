import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  checkUploadedFile,
  describeReadError,
  readFirstSheetRows,
} from "@/lib/excelUpload";
import { parseMaiDaiSheet } from "@/lib/statementReconcile";
import {
  describeShrink,
  needsShrinkConfirmation,
  summarizeMemberListChange,
} from "@/lib/memberListChange";
import { planDeductionUpload, wasSeeded } from "@/lib/deductionUpload";
import { applyRoundSheet, refreshRoundProgress } from "@/lib/roundMembers";
import { readMappedSheet } from "@/lib/mappedSheet";
import { parseConfirmedUpload } from "@/lib/uploadMapping";
import {
  applyDirectoryAccounts,
  recomputeRoundPayments,
  rematchRoundTransfers,
} from "@/lib/statementRecompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Takes a sheet of results — what each unit's payroll could and could not
// deduct — and tells the round about it.
//
// There are two shapes of round now, and this behaves differently in each.
//
// A round started from the รายการหัก (see ../deduction-list) already knows
// its population, so a result sheet *updates* it: the members it names get
// their result, the members it does not name are left exactly as they were.
// That is what lets one unit's file be uploaded on its own as it arrives —
// forty rows must not be read as "the other eleven hundred are finished" —
// and it is why the whole cooperative no longer has to be assembled into one
// file before anything can be reconciled.
//
// A round built the old way, from the results alone, keeps the old behaviour
// exactly, described below.
//
// Re-uploading replaces the list rather than merging into it: the sheet is
// regenerated locally whenever the หักไม่ได้ analysis is re-run, and a merge
// would leave members who dropped off the corrected sheet sitting in the
// round forever. Transfers already read out of statements survive the
// replacement and are re-matched against the new list, so correcting the
// sheet never costs the reconciliation work already done.
//
// The one thing that replacement cannot undo is uploading the wrong file, so
// a replacement that takes away most of the round comes back with 409 and the
// numbers instead of doing it — see lib/memberListChange.ts. Sending the same
// file again with confirm=yes goes through.
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

  // A mapping confirmed in the preview reads the file; without one the old
  // fixed-position contract still applies, which is what a round built before
  // any of this was uploaded with.
  const columns = parseConfirmedUpload(form.get("mapping"), form.get("firstDataRow"));
  const mapped = columns
    ? readMappedSheet(rows, columns.firstDataRow, columns.mapping)
    : null;

  const sheet = parseMaiDaiSheet(rows);
  const parsed = mapped ? mapped.rows.filter((row) => row.result === "uncollected") : sheet.rows;
  const allRows = mapped ? mapped.rows : sheet.all;

  // Who this file has no result for, counted from whichever reading produced
  // the rows above — taking these from the fixed-position parse while the
  // rows came from a confirmed mapping would put one file's numbers beside
  // another file's list.
  const awaitingFromSheet = mapped
    ? {
        members: mapped.awaiting,
        amount:
          Math.round(
            mapped.rows
              .filter((row) => row.result === "awaiting")
              .reduce((sum, row) => sum + (row.expectedAmount ?? 0), 0) * 100
          ) / 100,
        units: new Set(
          mapped.rows
            .filter((row) => row.result === "awaiting")
            .map((row) => row.hCode ?? row.unitName)
            .filter((unit): unit is string => Boolean(unit))
        ).size,
      }
    : {
        members: sheet.awaitingMembers,
        amount: sheet.awaitingAmount,
        units: sheet.awaitingUnits.length,
      };

  // Which round this is decides what the sheet means. Read before the
  // emptiness checks below, because on a seeded round a file of nothing but
  // "หักได้ครบ" is a perfectly good result to record — it is only on a round
  // that has to be *built* from this file that it leaves nothing behind.
  const roster = await prisma.statementMember.findMany({
    where: { roundId: round.id },
    select: {
      memberNumber: true,
      unitName: true,
      deductionResult: true,
      expectedAmount: true,
    },
  });
  const seeded = wasSeeded(roster);

  if (seeded) {
    if (allRows.length === 0) {
      return NextResponse.json(
        {
          error:
            "ไม่พบรายชื่อสมาชิกในไฟล์นี้ — ตรวจว่าคอลัมน์ A เป็นเลขสมาชิก และ E เป็นยอดหักไม่ได้",
        },
        { status: 400 }
      );
    }

    const plan = planDeductionUpload(roster, allRows);
    const filled = await applyRoundSheet(round.id, plan);
    const progress = await refreshRoundProgress(round.id);
    const missingAccountNow = await prisma.statementMember.count({
      where: { roundId: round.id, accountNumber: null, deductionResult: "uncollected" },
    });

    return NextResponse.json({
      applied: true,
      imported: progress.members,
      added: plan.create.length,
      updated: plan.update.length,
      keptResult: plan.keptResult.length,
      // How much of the round this file said nothing about — the honest
      // answer to "did I upload the right file", when one unit's file and
      // the whole cooperative's look the same from here.
      untouched: plan.untouched,
      skippedRows: mapped?.skipped ?? 0,
      missingAccount: missingAccountNow,
      filledFromDirectory: filled.fromDirectory,
      filledFromPrevious: filled.fromPrevious,
      ambiguousAccounts: filled.ambiguous,
      ...progress,
    });
  }

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

  // Asked before anything is deleted, and only when the replacement would
  // take away most of the round. The check reads the round's current list
  // rather than trusting a count sent from the browser, so a stale page
  // cannot wave it through.
  const change = summarizeMemberListChange(roster, parsed);
  const confirmed = form.get("confirm") === "yes";
  if (!confirmed && needsShrinkConfirmation(change)) {
    return NextResponse.json(
      { needsConfirm: true, change, error: describeShrink(change) },
      { status: 409 }
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
      awaitingUnits: awaitingFromSheet.units,
      awaitingMembers: awaitingFromSheet.members,
      awaitingAmount: awaitingFromSheet.amount,
    },
  });

  // Members the sheet left without an account number may already be known to
  // the directory from an earlier round, so filling those in first means the
  // work of binding accounts is not repeated every month.
  const filled = await applyDirectoryAccounts(round.id);

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
    // What this upload changed about the round's population, so the notice
    // can say it plainly whether or not it had to stop and ask.
    removed: change.removedCount,
    removedUnits: change.removedUnits.length,
    // Members with no account number can never be matched to a transfer, so
    // staff need to know up front rather than wondering why they stay ❌.
    missingAccount,
    filledFromDirectory: filled.fromDirectory,
    filledFromPrevious: filled.fromPrevious,
    ambiguousAccounts: filled.ambiguous,
    awaitingUnits: awaitingFromSheet.units,
    awaitingMembers: awaitingFromSheet.members,
    awaitingAmount: awaitingFromSheet.amount,
  });
}
