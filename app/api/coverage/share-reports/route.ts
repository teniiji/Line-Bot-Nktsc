import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkUploadedFile, describeReadError, readAllSheetRows } from "@/lib/excelUpload";
import { cleanShareEntries, parseShareDebtSheet, ShareDebtSheetError, type ShareDebtEntry } from "@/lib/shareDebt";

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

const parseAsOf = (v: unknown) => {
  const text = String(v ?? "").trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

// POST — an Excel file as a form, or, for the printed PDF report, the figures
// the browser read from it as JSON ({ asOf, label, fileName, entries }): the
// PDF itself is too big to send (lib/shareDebtPdf.ts).
export async function POST(request: NextRequest) {
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const body = await request.json().catch(() => null);
    const asOf = parseAsOf(body?.asOf);
    if (!asOf) return NextResponse.json({ error: "ต้องใส่วันที่ของยอดหุ้นหนี้" }, { status: 400 });
    const cleaned = cleanShareEntries(body?.entries);
    if ("error" in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 });
    const fileName = typeof body?.fileName === "string" ? body.fileName.slice(0, 200) : null;
    const label = String(body?.label ?? "").trim().slice(0, 100) || (fileName ?? "").replace(/\.pdf$/i, "") || "รายงานหุ้นหนี้";
    const id = await saveReport({ label, asOf, fileName, debtColumns: "รวม (PDF)", entries: cleaned.entries });
    return NextResponse.json({ id, label, imported: cleaned.entries.length, debtColumns: ["รวม (PDF)"], sharesColumn: "ทุนเรือนหุ้น", periodsColumn: "หุ้น/เดือน (งวด)" });
  }

  const form = await request.formData();
  const checked = checkUploadedFile(form.get("file"));
  if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });

  const asOf = parseAsOf(form.get("asOf"));
  if (!asOf) return NextResponse.json({ error: "ต้องใส่วันที่ของยอดหุ้นหนี้" }, { status: 400 });

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
  const id = await saveReport({
    label,
    asOf,
    fileName: checked.file.name,
    debtColumns: parsed.debtColumns.join(" + ") || null,
    entries: parsed.entries,
  });

  return NextResponse.json({
    id,
    label,
    imported: parsed.entries.length,
    duplicates: parsed.duplicates,
    debtColumns: parsed.debtColumns,
    sharesColumn: parsed.sharesColumn,
    periodsColumn: parsed.periodsColumn,
  });
}

async function saveReport(r: {
  label: string;
  asOf: Date;
  fileName: string | null;
  debtColumns: string | null;
  entries: ShareDebtEntry[];
}) {
  const report = await prisma.shareDebtReport.create({
    data: { label: r.label, asOf: r.asOf, fileName: r.fileName, debtColumns: r.debtColumns, memberCount: r.entries.length },
  });
  try {
    for (let i = 0; i < r.entries.length; i += WRITE_CHUNK) {
      await prisma.shareDebtEntry.createMany({
        data: r.entries.slice(i, i + WRITE_CHUNK).map((e) => ({ ...e, reportId: report.id })),
      });
    }
  } catch (err) {
    // Half a report would show half the membership's debt as the latest.
    await prisma.shareDebtReport.delete({ where: { id: report.id } });
    throw err;
  }
  return report.id;
}
