import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkUploadedFile, describeReadError, readFirstSheetRows } from "@/lib/excelUpload";
import {
  BankAccountSheetError,
  dedupeByAccount,
  findAccountConflicts,
  parseBankAccountSheet,
} from "@/lib/bankAccountSheet";
import { rematchRoundsForAccounts } from "@/lib/statementRecompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Loads the cooperative's own "เลขสมาชิก → เลขบัญชี" spreadsheet into the
// directory in one go.
//
// The directory was only ever built a row at a time, as staff resolved
// transfers the หักไม่ได้ sheet could not place, so it holds a fraction of the
// members — and it is the source of the strongest evidence the reconciliations
// have ("the directory says this account is theirs"). The cooperative already
// keeps the same mapping in a file; this reads it.
//
// Adding, never replacing: a binding the file does not mention is left alone.
// The file is one source among several — staff bind accounts by hand from
// slips and phone calls too, and those bindings are often the ones the
// spreadsheet is missing.

// Written in chunks so one import does not hold a single enormous transaction
// open. Each chunk is atomic, which is the level that matters: a chunk either
// binds its accounts or none of them.
const WRITE_CHUNK = 200;

// Postgres caps how many parameters one statement can bind, and this file can
// carry the whole membership, so every lookup keyed on the imported accounts
// is asked in slices rather than as one enormous IN list.
const LOOKUP_CHUNK = 1000;

async function inChunks<T, R>(
  values: T[],
  fetch: (slice: T[]) => Promise<R[]>
): Promise<R[]> {
  const all: R[] = [];
  for (let i = 0; i < values.length; i += LOOKUP_CHUNK) {
    all.push(...(await fetch(values.slice(i, i + LOOKUP_CHUNK))));
  }
  return all;
}

export async function POST(request: NextRequest) {
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

  let sheet;
  try {
    sheet = parseBankAccountSheet(rows);
  } catch (err) {
    if (err instanceof BankAccountSheetError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  if (sheet.rows.length === 0) {
    return NextResponse.json(
      {
        error:
          "พบหัวตารางแล้วแต่ไม่มีแถวข้อมูลที่ใช้ได้เลย — ตรวจว่าคอลัมน์เลขสมาชิกและเลขบัญชีมีข้อมูลจริง",
        problems: sheet.problems.slice(0, 20),
        problemCount: sheet.problems.length,
      },
      { status: 400 }
    );
  }

  // Refused rather than imported partially: one account belongs to one member,
  // so a file claiming otherwise would bind it to whichever row came last —
  // a silent, wrong answer to a question the file itself cannot settle.
  const conflicts = findAccountConflicts(sheet.rows);
  if (conflicts.length > 0) {
    return NextResponse.json(
      {
        error:
          `ไฟล์นี้มีเลขบัญชีเดียวกันผูกกับสมาชิกคนละคน ${conflicts.length} เลขบัญชี — ` +
          "บัญชีหนึ่งเป็นของสมาชิกคนเดียวเท่านั้น กรุณาแก้ไฟล์ให้ชัดเจนก่อนแล้วอัปโหลดใหม่ (ยังไม่ได้บันทึกอะไรลงระบบ)",
        conflicts: conflicts.slice(0, 20),
        conflictCount: conflicts.length,
      },
      { status: 400 }
    );
  }

  const incoming = dedupeByAccount(sheet.rows);

  // Compared before writing so the report can say what actually changed —
  // "อัปเดต 3" after importing 1,200 rows is the sentence that tells staff the
  // file added nothing new, which is worth knowing.
  const existing = await inChunks(
    incoming.map((row) => row.accountNumber),
    (accountNumbers) =>
      prisma.memberBankAccount.findMany({
        where: { accountNumber: { in: accountNumbers } },
        select: { accountNumber: true, memberNumber: true },
      })
  );
  const existingOwner = new Map(existing.map((row) => [row.accountNumber, row.memberNumber]));

  const added = incoming.filter((row) => !existingOwner.has(row.accountNumber));
  // A binding the file points at a different member than the system holds.
  // Reported separately from the count, because re-pointing an account moves
  // money on the reconciliation screens and staff should see it happen.
  const repointed = incoming.filter((row) => {
    const owner = existingOwner.get(row.accountNumber);
    return owner !== undefined && owner !== row.memberNumber;
  });
  const unchanged = incoming.length - added.length - repointed.length;

  // The roster's name is preferred over the file's, the same way the one-row
  // form does it: the roster is canonical and the file may be years old.
  const roster = await inChunks(
    [...new Set(incoming.map((row) => row.memberNumber))],
    (memberNumbers) =>
      prisma.memberRoster.findMany({
        where: { memberNumber: { in: memberNumbers } },
        select: { memberNumber: true, memberName: true },
      })
  );
  const rosterName = new Map(roster.map((row) => [row.memberNumber, row.memberName]));

  for (let i = 0; i < incoming.length; i += WRITE_CHUNK) {
    const chunk = incoming.slice(i, i + WRITE_CHUNK);
    await prisma.$transaction(
      chunk.map((row) =>
        prisma.memberBankAccount.upsert({
          where: { accountNumber: row.accountNumber },
          create: {
            accountNumber: row.accountNumber,
            memberNumber: row.memberNumber,
            memberName: rosterName.get(row.memberNumber) ?? row.memberName,
            note: "นำเข้าจากไฟล์ทะเบียนเลขบัญชี",
          },
          update: {
            memberNumber: row.memberNumber,
            memberName: rosterName.get(row.memberNumber) ?? row.memberName,
          },
        })
      )
    );
  }

  // Members the file names that the roster has never heard of. Not refused —
  // the roster is imported separately and lags — but surfaced, because a
  // member number nobody recognises is usually a typo in the spreadsheet.
  const unknownMembers = [
    ...new Set(incoming.filter((row) => !rosterName.has(row.memberNumber)).map((r) => r.memberNumber)),
  ];

  // Only rounds whose statements actually carry one of these accounts are
  // touched, and each is recomputed once however many rows named it.
  const roundsRematched = await rematchRoundsForAccounts(incoming.map((row) => row.accountNumber));

  return NextResponse.json({
    read: sheet.rows.length,
    imported: incoming.length,
    added: added.length,
    repointed: repointed.length,
    unchanged,
    blankRows: sheet.blankRows,
    problemCount: sheet.problems.length,
    problems: sheet.problems.slice(0, 20),
    unknownMemberCount: unknownMembers.length,
    unknownMembers: unknownMembers.slice(0, 20),
    roundsRematched,
  });
}
