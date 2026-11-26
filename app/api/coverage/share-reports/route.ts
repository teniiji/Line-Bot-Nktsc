import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkUploadedFile, describeReadError, readAllSheetRows } from "@/lib/excelUpload";
import { parseShareDebtSheet, ShareDebtSheetError } from "@/lib/shareDebt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The monthly share-and-debt reports (lib/shareDebt.ts). Each import is kept
// as its own report; the coverage tab uses the latest.

export async function GET() {
  const data = await prisma.shareDebtReport.findMany({
    orderBy: [{ asOf: "desc" }, { createdAt: "desc" }],
    take: 24,
  });
  return NextResponse.json({ data });
}

const WRITE_CHUNK = 1000;

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const checked = checkUploadedFile(form.get("file"));
  if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });

  const asOfText = String(form.get("asOf") ?? "").trim();
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(asOfText) ? new Date(`${asOfText}T00:00:00Z`) : null;
  if (!asOf || Number.isNaN(asOf.getTime())) {
    return NextResponse.json({ error: "ต้องใส่วันที่ของยอดหุ้นหนี้" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseShareDebtSheet(await readAllSheetRows(checked.file));
  } catch (err) {
    if (err instanceof ShareDebtSheetError) return NextResponse.json({ error: err.message }, { status: 400 });
    return NextResponse.json({ error: describeReadError(err) }, { status: 400 });
  }
  if (parsed.entries.length === 0) {
    return NextResponse.json({ error: "ไม่พบรายชื่อสมาชิกในไฟล์" }, { status: 400 });
  }

  const label =
    String(form.get("label") ?? "").trim() || checked.file.name.replace(/\.xlsx?$/i, "");
  const report = await prisma.shareDebtReport.create({
    data: {
      label,
      asOf,
      fileName: checked.file.name,
      debtColumns: parsed.debtColumns.join(" + ") || null,
      memberCount: parsed.entries.length,
    },
  });
  try {
    for (let i = 0; i < parsed.entries.length; i += WRITE_CHUNK) {
      await prisma.shareDebtEntry.createMany({
        data: parsed.entries.slice(i, i + WRITE_CHUNK).map((e) => ({ ...e, reportId: report.id })),
      });
    }
  } catch (err) {
    // Half a report would show half the membership's debt as the latest.
    await prisma.shareDebtReport.delete({ where: { id: report.id } });
    throw err;
  }

  return NextResponse.json({
    id: report.id,
    label,
    imported: parsed.entries.length,
    duplicates: parsed.duplicates,
    debtColumns: parsed.debtColumns,
    sharesColumn: parsed.sharesColumn,
    periodsColumn: parsed.periodsColumn,
  });
}
