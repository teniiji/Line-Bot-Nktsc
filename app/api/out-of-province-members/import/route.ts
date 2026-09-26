import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkUploadedFile, describeReadError, readFirstSheetRows } from "@/lib/excelUpload";
import { syncOfficeMembers } from "@/lib/unitPayerOfficeStore";
import {
  OutOfProvinceSheetError,
  dedupeByMember,
  findUnitConflicts,
  parseOutOfProvinceSheet,
} from "@/lib/outOfProvinceSheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Loads the out-of-province list (see lib/outOfProvinceSheet.ts). Adding and
// updating, never removing: a member the file does not mention is left as
// they are — one comes off by hand, from the list on the dashboard.

const WRITE_CHUNK = 200;

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
    sheet = parseOutOfProvinceSheet(rows);
  } catch (err) {
    if (err instanceof OutOfProvinceSheetError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  if (sheet.rows.length === 0) {
    return NextResponse.json(
      {
        error: sheet.hasConfirmColumn
          ? 'ไม่มีแถวที่ติ๊ก ✓ ในคอลัมน์ "ยืนยัน" ที่ใช้ได้เลย — ติ๊กแถวที่ตรวจแล้วก่อนอัปโหลด'
          : "พบหัวตารางแล้วแต่ไม่มีแถวที่มีทั้งเลขสมาชิกและหน่วยงานหักเงิน",
        problems: sheet.problems.slice(0, 20),
        problemCount: sheet.problems.length,
        unconfirmed: sheet.unconfirmed,
      },
      { status: 400 }
    );
  }

  const conflicts = findUnitConflicts(sheet.rows);
  if (conflicts.length > 0) {
    return NextResponse.json(
      {
        error:
          `ไฟล์นี้มีสมาชิก ${conflicts.length} คนที่อยู่คนละหน่วยงานหักเงินในไฟล์เดียวกัน — ` +
          "สมาชิกหนึ่งคนหักผ่านได้ทีละหน่วยงาน กรุณาแก้ไฟล์ให้เหลือหน่วยงานเดียวแล้วอัปโหลดใหม่ (ยังไม่ได้บันทึกอะไรลงระบบ)",
        conflicts: conflicts.slice(0, 20),
        conflictCount: conflicts.length,
      },
      { status: 400 }
    );
  }

  const incoming = dedupeByMember(sheet.rows);
  const numbers = incoming.map((row) => row.memberNumber);

  const [existing, roster] = await Promise.all([
    prisma.outOfProvinceMember.findMany({
      where: { memberNumber: { in: numbers } },
      select: { memberNumber: true, deductingUnit: true },
    }),
    prisma.memberRoster.findMany({
      where: { memberNumber: { in: numbers } },
      select: { memberNumber: true },
    }),
  ]);
  const unitOf = new Map(existing.map((row) => [row.memberNumber, row.deductingUnit]));
  const added = incoming.filter((row) => !unitOf.has(row.memberNumber)).length;
  // A member the system already had under a different office. Counted apart,
  // because it changes which office's transfer they are looked for in.
  const moved = incoming.filter((row) => {
    const unit = unitOf.get(row.memberNumber);
    return unit !== undefined && unit !== row.deductingUnit;
  }).length;

  for (let i = 0; i < incoming.length; i += WRITE_CHUNK) {
    await prisma.$transaction(
      incoming.slice(i, i + WRITE_CHUNK).map((row) => {
        const data = {
          memberName: row.memberName,
          deductingUnit: row.deductingUnit,
          originalUnit: row.originalUnit,
          note: row.note,
        };
        return prisma.outOfProvinceMember.upsert({
          where: { memberNumber: row.memberNumber },
          create: { memberNumber: row.memberNumber, ...data },
          update: data,
        });
      })
    );
  }

  // Offices already linked to a statement unit pick up their new members.
  const unitSync = await syncOfficeMembers();

  // Not refused — the roster is imported separately and may lag — but a
  // member number nobody recognises is usually a typo, so it is named.
  const inRoster = new Set(roster.map((row) => row.memberNumber));
  const unknownMembers = numbers.filter((n) => !inRoster.has(n));

  return NextResponse.json({
    imported: incoming.length,
    added,
    moved,
    unchanged: incoming.length - added - moved,
    unconfirmed: sheet.unconfirmed,
    addedToUnits: unitSync.added,
    blankRows: sheet.blankRows,
    problemCount: sheet.problems.length,
    problems: sheet.problems.slice(0, 20),
    unknownMemberCount: unknownMembers.length,
    unknownMembers: unknownMembers.slice(0, 20),
  });
}
