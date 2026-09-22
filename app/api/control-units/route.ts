import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkUploadedFile, describeReadError, readFirstSheetRows } from "@/lib/excelUpload";
import { controlUnitCode, readControlUnitSheet } from "@/lib/controlUnitSheet";
import { CONTROL_UNIT_NAMES } from "@/lib/controlUnits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The cooperative's หน่วยคุม, kept where staff can change them.
//
// The list used to live in the code, which meant a unit added in October
// had no name until somebody deployed. It is the cooperative's own
// reference data and it is thirty lines of it — there was never a good
// reason for it to be ours.

function compareCode(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b, "th");
}

export async function GET() {
  const units = await prisma.controlUnit.findMany({
    select: { code: true, name: true, note: true, updatedAt: true },
  });

  // The built-in list answers for a database nobody has seeded — a fresh
  // environment, or the moment before the seeding migration runs. A unit
  // without a name is a unit nobody can pick out of the filter.
  const fromCode = Object.entries(CONTROL_UNIT_NAMES)
    .filter(([code]) => !units.some((unit) => unit.code === code))
    .map(([code, name]) => ({ code, name, note: null, updatedAt: null }));

  return NextResponse.json({
    data: [...units, ...fromCode].sort((a, b) => compareCode(a.code, b.code)),
  });
}

// Replaces nothing and removes nothing: the file adds the units it names and
// corrects the names it gives. A list of one unit is a legitimate upload —
// "this one was renamed" — and reading it as the whole list would take the
// other ninety-one away.
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

  const sheet = readControlUnitSheet(rows);
  if (sheet.rows.length === 0) {
    return NextResponse.json(
      {
        error:
          "ไม่พบหน่วยคุมในไฟล์นี้ — ต้องเป็นไฟล์ 2 คอลัมน์: คอลัมน์ A รหัสหน่วยคุม (ตัวเลข) และคอลัมน์ B ชื่อหน่วยคุม",
      },
      { status: 400 }
    );
  }

  const existing = await prisma.controlUnit.findMany({ select: { code: true, name: true } });
  const have = new Map(existing.map((unit) => [unit.code, unit.name]));

  const added = sheet.rows.filter((row) => !have.has(row.code));
  const renamed = sheet.rows.filter((row) => have.has(row.code) && have.get(row.code) !== row.name);

  for (const row of sheet.rows) {
    await prisma.controlUnit.upsert({
      where: { code: row.code },
      update: { name: row.name },
      create: { code: row.code, name: row.name },
    });
  }

  return NextResponse.json({
    added: added.length,
    renamed: renamed.length,
    unchanged: sheet.rows.length - added.length - renamed.length,
    // Units the table has that this file said nothing about — kept, and
    // counted so uploading one unit's correction does not look like it
    // dropped the rest.
    untouched: existing.filter((unit) => !sheet.rows.some((row) => row.code === unit.code)).length,
    skippedRows: sheet.skipped,
    total: sheet.rows.length,
  });
}

// One unit renamed by hand, which is what a typo needs — no file, no upload.
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const code = controlUnitCode(body?.code);
  const name = String(body?.name ?? "").replace(/\s+/g, " ").trim();

  if (!code) {
    return NextResponse.json({ error: "รหัสหน่วยคุมต้องเป็นตัวเลข" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "ต้องใส่ชื่อหน่วยคุม" }, { status: 400 });
  }

  const unit = await prisma.controlUnit.upsert({
    where: { code },
    update: { name },
    create: { code, name },
    select: { code: true, name: true, note: true, updatedAt: true },
  });
  return NextResponse.json(unit);
}
