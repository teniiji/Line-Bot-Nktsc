import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkUploadedFile, describeReadError, readAllSheetRows } from "@/lib/excelUpload";
import { ApprovalSheetError, isProduct, parseApprovalSheet, type EnrollmentStatus } from "@/lib/enrollment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST (multipart): file, product, result ("approved"/"rejected").
// The insurer's or an association's file of decisions. Each member listed
// settles their pending application for that product: the file's own result
// column where it has one, otherwise the result staff chose for the file.
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const product = String(form.get("product") ?? "");
  const fallback = form.get("result") === "rejected" ? "rejected" : "approved";
  if (!isProduct(product)) return NextResponse.json({ error: "ต้องเลือกว่าเป็นไฟล์ผลของอะไร" }, { status: 400 });
  const checked = checkUploadedFile(form.get("file"));
  if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });

  let listed;
  try {
    listed = parseApprovalSheet(await readAllSheetRows(checked.file));
  } catch (err) {
    const message = err instanceof ApprovalSheetError ? err.message : describeReadError(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const source = checked.file.name;
  const now = new Date();
  const counts: Record<EnrollmentStatus, number> = { pending: 0, approved: 0, rejected: 0 };
  const notPending: string[] = [];
  for (const { memberNumber, result } of listed) {
    const status = result ?? fallback;
    const { count } = await prisma.coverageEnrollment.updateMany({
      where: { memberNumber, product, status: "pending" },
      data: { status, statusDate: now, statusSource: source },
    });
    if (count) counts[status] += count;
    else notPending.push(memberNumber);
  }
  return NextResponse.json({
    listed: listed.length,
    approved: counts.approved,
    rejected: counts.rejected,
    notPendingCount: notPending.length,
    notPending: notPending.slice(0, 50),
  });
}
