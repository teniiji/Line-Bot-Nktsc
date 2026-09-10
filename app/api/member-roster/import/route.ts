import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkUploadedFile, describeReadError, readFirstSheetRows } from "@/lib/excelUpload";
import {
  MemberRosterSheetError,
  dedupeByMember,
  findMemberConflicts,
  parseMemberRosterSheet,
} from "@/lib/memberRosterSheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Loads the cooperative's member list into MemberRoster from the dashboard.
//
// It could already be done, but only by running a script from a machine with
// the production DATABASE_URL — so in practice it was done once and then the
// roster drifted, and the panel shows members with "—" in every column.
//
// Adding and updating, never deleting: a member the file does not mention is
// left alone. The file is one source among several — staff add members by hand
// from service requests and verified transactions too, and a list exported
// last month would otherwise silently remove them.
const WRITE_CHUNK = 200;
const LOOKUP_CHUNK = 1000;

async function inChunks<T, R>(values: T[], fetch: (slice: T[]) => Promise<R[]>): Promise<R[]> {
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
    sheet = parseMemberRosterSheet(rows);
  } catch (err) {
    if (err instanceof MemberRosterSheetError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  if (sheet.rows.length === 0) {
    return NextResponse.json(
      {
        error:
          "พบหัวตารางแล้วแต่ไม่มีแถวข้อมูลที่ใช้ได้เลย — ตรวจว่าคอลัมน์เลขสมาชิกและชื่อมีข้อมูลจริง",
        problems: sheet.problems.slice(0, 20),
        problemCount: sheet.problems.length,
      },
      { status: 400 }
    );
  }

  // Refused rather than imported partially: the file names one member number
  // as two different people, and importing it would write whichever row came
  // last — a silent, wrong answer to a question only the file can settle.
  const conflicts = findMemberConflicts(sheet.rows);
  if (conflicts.length > 0) {
    return NextResponse.json(
      {
        error:
          `ไฟล์นี้มีเลขสมาชิกเดียวกันแต่คนละชื่อ ${conflicts.length} เลข — ` +
          "กรุณาแก้ไฟล์ให้ชัดเจนก่อนแล้วอัปโหลดใหม่ (ยังไม่ได้บันทึกอะไรลงระบบ)",
        conflicts: conflicts.slice(0, 20),
        conflictCount: conflicts.length,
      },
      { status: 400 }
    );
  }

  const incoming = dedupeByMember(sheet.rows);

  // Read before writing so the report can say what actually changed. "อัปเดต 3"
  // after importing 1,200 rows is the sentence that tells staff the file added
  // nothing new, which is worth knowing.
  const existing = await inChunks(
    incoming.map((row) => row.memberNumber),
    (memberNumbers) =>
      prisma.memberRoster.findMany({
        where: { memberNumber: { in: memberNumbers } },
        select: { memberNumber: true, nationalId: true, phone: true },
      })
  );
  const existingByMember = new Map(existing.map((row) => [row.memberNumber, row]));

  const added = incoming.filter((row) => !existingByMember.has(row.memberNumber));
  // What the import is usually for: members already on file who had no way to
  // be identity-verified until now.
  const filledNationalId = incoming.filter(
    (row) => row.nationalId && !existingByMember.get(row.memberNumber)?.nationalId
  );
  const filledPhone = incoming.filter(
    (row) => row.phone && !existingByMember.get(row.memberNumber)?.phone
  );

  for (let i = 0; i < incoming.length; i += WRITE_CHUNK) {
    const chunk = incoming.slice(i, i + WRITE_CHUNK);
    await prisma.$transaction(
      chunk.map((row) =>
        prisma.memberRoster.upsert({
          where: { memberNumber: row.memberNumber },
          create: {
            memberNumber: row.memberNumber,
            memberName: row.memberName,
            unitName: row.unitName,
            nationalId: row.nationalId,
            phone: row.phone,
            // lineUserId is never written here. It is the bot's binding and
            // the impersonation guard reads it — see lib/memberRosterSheet.ts.
          },
          update: {
            memberName: row.memberName,
            // A field the file does not carry must not blank one already on
            // record: a list with no phone column would otherwise wipe every
            // phone number in the cooperative.
            ...(row.unitName ? { unitName: row.unitName } : {}),
            ...(row.nationalId ? { nationalId: row.nationalId } : {}),
            ...(row.phone ? { phone: row.phone } : {}),
          },
        })
      )
    );
  }

  return NextResponse.json({
    read: sheet.rows.length,
    imported: incoming.length,
    added: added.length,
    updated: incoming.length - added.length,
    filledNationalId: filledNationalId.length,
    filledPhone: filledPhone.length,
    blankRows: sheet.blankRows,
    columns: sheet.columns,
    problems: sheet.problems.slice(0, 20),
    problemCount: sheet.problems.length,
  });
}
