import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkUploadedFile, describeReadError, readAllSheetRows } from "@/lib/excelUpload";
import {
  ENROLLMENT_PRODUCTS,
  PAYMENT_METHODS,
  POLICY_YEAR_END_KEY,
  PRODUCT_ASSOC,
  isProduct,
  proratedPremium,
} from "@/lib/enrollment";
import { ApplicantSheetError, parseApplicantSheet, planApplicants } from "@/lib/enrollmentImport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST (multipart) — a list of a round's applicants (lib/enrollmentImport.ts).
//   file, product, mode = "preview" | "commit", defaultDate (YYYY-MM-DD, for
//   rows with no round), status ("pending" | "approved"), department,
//   recordedBy, eligibilityChecked, paymentMethod (life only).
// preview returns the plan and writes nothing; commit works the plan out
// again from the same file and records the rows it would create.
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const product = String(form.get("product") ?? "");
  if (!isProduct(product) || product === "relative") {
    return NextResponse.json({ error: "ต้องเลือกว่าเป็นรายชื่อสมัครอะไร" }, { status: 400 });
  }
  const checked = checkUploadedFile(form.get("file"));
  if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });
  const commit = form.get("mode") === "commit";
  const defaultDateText = String(form.get("defaultDate") ?? "");
  const defaultDate = /^\d{4}-\d{2}-\d{2}$/.test(defaultDateText) ? defaultDateText : null;

  let parsed;
  try {
    parsed = parseApplicantSheet(await readAllSheetRows(checked.file));
  } catch (err) {
    const message = err instanceof ApplicantSheetError ? err.message : describeReadError(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (product === "life" && !parsed.hasLifeColumns) {
    return NextResponse.json(
      { error: 'รายชื่อประกันชีวิตต้องมีคอลัมน์ "วงเงินคุ้มครอง" หรือ "ทุนประกัน" และ "เบี้ยประกัน"' },
      { status: 400 }
    );
  }

  const numbers = [...new Set(parsed.rows.map((r) => r.memberNumber))];
  const roster = new Map<string, { memberName: string; unitName: string | null }>();
  for (let i = 0; i < numbers.length; i += 1000) {
    const found = await prisma.memberRoster.findMany({
      where: { memberNumber: { in: numbers.slice(i, i + 1000) } },
      select: { memberNumber: true, memberName: true, unitName: true },
    });
    for (const f of found) roster.set(f.memberNumber, f);
  }
  const [recorded, yearly, yearEnd] = await Promise.all([
    prisma.coverageEnrollment.findMany({
      where: { memberNumber: { in: numbers }, action: "enroll", status: { not: "rejected" } },
      select: { memberNumber: true, product: true, relativeName: true },
    }),
    prisma.memberCoverage.findMany({
      where: { memberNumber: { in: numbers }, snapshot: { isCurrent: true } },
      select: { memberNumber: true, insuredSum: true, hasSok: true, hasScs: true, hasSst: true, hasSsk: true, age: true },
    }),
    prisma.appSetting.findUnique({ where: { key: POLICY_YEAR_END_KEY } }),
  ]);
  const flag = PRODUCT_ASSOC[product];
  const inYearlyFile = new Set(
    yearly.filter((m) => (product === "life" ? m.insuredSum > 0 : flag ? m[flag] : false)).map((m) => m.memberNumber)
  );

  const plan = planApplicants(parsed.rows, { product, defaultDate, roster, recorded, inYearlyFile });
  const toCreate = plan.filter((p) => p.action === "create");

  if (!commit) {
    return NextResponse.json({
      product,
      rows: plan,
      create: toCreate.length,
      skip: plan.length - toCreate.length,
      missingDate: plan.some((p) => !p.applicationDate),
    });
  }

  // Recording: the same checks the one-at-a-time form makes.
  const department = String(form.get("department") ?? "").trim();
  const recordedBy = String(form.get("recordedBy") ?? "").trim();
  const status = form.get("status") === "approved" ? "approved" : "pending";
  const paymentMethod = String(form.get("paymentMethod") ?? "");
  if (!department) return NextResponse.json({ error: "ต้องเลือกแผนกที่รับเรื่อง" }, { status: 400 });
  if (!recordedBy) return NextResponse.json({ error: "ต้องใส่ชื่อผู้บันทึก" }, { status: 400 });
  if (form.get("eligibilityChecked") !== "true") {
    return NextResponse.json({ error: "ต้องตรวจคุณสมบัติตามประกาศก่อน แล้วติ๊กยืนยัน" }, { status: 400 });
  }
  if (product === "life" && !(paymentMethod in PAYMENT_METHODS)) {
    return NextResponse.json({ error: "ต้องเลือกวิธีชำระเบี้ย" }, { status: 400 });
  }
  if (toCreate.length === 0) return NextResponse.json({ error: "ไม่มีรายชื่อที่ต้องบันทึก" }, { status: 400 });

  const ages = new Map(yearly.map((m) => [m.memberNumber, m.age]));
  const now = new Date();
  const source = `นำเข้ารายชื่อ ${checked.file.name}`;
  const { count } = await prisma.coverageEnrollment.createMany({
    data: toCreate.map((p) => {
      const applicationDate = new Date(`${p.applicationDate}T00:00:00Z`);
      const life = p.product === "life";
      const premium = life ? Math.round(p.annualPremium ?? 0) : null;
      const member = roster.get(p.memberNumber);
      return {
        memberNumber: p.memberNumber,
        memberName: member?.memberName ?? null,
        unitName: member?.unitName ?? null,
        age: ages.get(p.memberNumber) ?? null,
        product: p.product,
        action: "enroll",
        applicationDate,
        insuredSum: life ? Math.round(p.insuredSum ?? 0) : null,
        annualPremium: premium,
        proratedPremium: life && premium ? proratedPremium(premium, applicationDate, yearEnd?.value ?? null) : null,
        paymentMethod: life ? paymentMethod : null,
        relativeName: p.product === "relative" ? p.name : null,
        status,
        statusDate: status === "approved" ? now : null,
        statusSource: status === "approved" ? source : null,
        eligibilityChecked: true,
        department,
        recordedBy,
        note:
          `${source} แถว ${p.rowNumber}` +
          (p.product === "relative" ? ` · ${ENROLLMENT_PRODUCTS[product]} (${p.relativeMark}${p.memberNumber})` : "") +
          (p.amount != null ? ` · เรียกเก็บ ${p.amount.toLocaleString("th-TH")}` : ""),
      };
    }),
  });
  return NextResponse.json({ created: count, skipped: plan.length - toCreate.length });
}
