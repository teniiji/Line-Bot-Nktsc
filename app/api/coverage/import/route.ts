import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkUploadedFile, describeReadError, readAllSheetRows } from "@/lib/excelUpload";
import { CoverageSheetError, parseCoverageSheet } from "@/lib/coverageSheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Loads สมาชิกทำประกันและฌาปนกิจ_2570.xlsx (sheet "รายชื่อ") as a new round.
//
// Every import is a new round rather than an overwrite: the figures belong to
// a date (the share-and-debt report, the policy year), and next year's file
// should sit beside this year's, not erase it. The new round becomes the one
// the tab shows.

const WRITE_CHUNK = 500;

const parseDate = (v: FormDataEntryValue | null): Date | null => {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const checked = checkUploadedFile(form.get("file"));
  if ("error" in checked) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  let sheets: unknown[][][];
  try {
    sheets = await readAllSheetRows(checked.file);
  } catch (err) {
    return NextResponse.json({ error: describeReadError(err) }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseCoverageSheet(sheets);
  } catch (err) {
    if (err instanceof CoverageSheetError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const labelInput = form.get("label");
  const label =
    (typeof labelInput === "string" && labelInput.trim()) || checked.file.name.replace(/\.xlsx?$/i, "");

  const snapshot = await prisma.$transaction(async (tx) => {
    // A new round keeps the amounts the last one was set to (each
    // association's benefit, the welfare rate and cap), not the defaults.
    const previous = await tx.coverageSnapshot.findFirst({
      where: { isCurrent: true },
      orderBy: { createdAt: "desc" },
      select: { benefitSok: true, benefitScs: true, benefitSst: true, benefitSsk: true, welfarePerPeriod: true, welfareCap: true },
    });
    await tx.coverageSnapshot.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
    return tx.coverageSnapshot.create({
      data: {
        ...(previous ?? {}),
        label,
        asOf: parseDate(form.get("asOf")),
        ageAsOf: parseDate(form.get("ageAsOf")),
        isCurrent: true,
      },
    });
  });

  try {
    for (let i = 0; i < parsed.rows.length; i += WRITE_CHUNK) {
      await prisma.memberCoverage.createMany({
        data: parsed.rows.slice(i, i + WRITE_CHUNK).map((r) => ({ ...r, snapshotId: snapshot.id })),
      });
    }
  } catch (err) {
    // A half-written round is worse than none: it would show as current with
    // part of the membership missing from every total.
    await prisma.coverageSnapshot.delete({ where: { id: snapshot.id } });
    throw err;
  }

  const known = new Set<string>();
  const numbers = parsed.rows.map((r) => r.memberNumber);
  for (let i = 0; i < numbers.length; i += 1000) {
    const found = await prisma.memberRoster.findMany({
      where: { memberNumber: { in: numbers.slice(i, i + 1000) } },
      select: { memberNumber: true },
    });
    for (const f of found) known.add(f.memberNumber);
  }
  const unknownMembers = numbers.filter((n) => !known.has(n));

  return NextResponse.json({
    snapshotId: snapshot.id,
    label,
    imported: parsed.rows.length,
    problems: parsed.problems.slice(0, 20),
    problemCount: parsed.problems.length,
    unknownMemberCount: unknownMembers.length,
    unknownMembers: unknownMembers.slice(0, 30),
  });
}
