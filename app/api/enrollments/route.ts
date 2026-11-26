import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { memberNumberKey } from "@/lib/memberNumber";
import {
  POLICY_YEAR_END_KEY,
  enrollmentProblem,
  isProduct,
  proratedPremium,
  summarize,
} from "@/lib/enrollment";

export const dynamic = "force-dynamic";

// GET /api/enrollments?month=2026-11&product=&status=&search=
// The applications made in a month (by application date), newest first, and
// that month's counts.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const month = /^\d{4}-\d{2}$/.test(q.get("month") ?? "") ? q.get("month")! : new Date().toISOString().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  const inMonth = { applicationDate: { gte: from, lt: to } };

  const product = q.get("product");
  const status = q.get("status");
  const search = (q.get("search") ?? "").trim();

  const [all, data] = await Promise.all([
    prisma.coverageEnrollment.findMany({
      where: inMonth,
      select: { product: true, action: true, status: true, proratedPremium: true },
    }),
    prisma.coverageEnrollment.findMany({
      where: {
        ...inMonth,
        ...(isProduct(product) ? { product } : {}),
        ...(status ? { status } : {}),
        ...(search
          ? {
              OR: [
                { memberNumber: { contains: search } },
                { memberName: { contains: search, mode: "insensitive" as const } },
                { relativeName: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ applicationDate: "desc" }, { createdAt: "desc" }],
      take: 1000,
    }),
  ]);
  return NextResponse.json({ month, data, summary: summarize(all) });
}

// POST /api/enrollments — one application or cancellation.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const input = {
    memberNumber: String(body.memberNumber ?? ""),
    product: String(body.product ?? ""),
    action: String(body.action ?? "enroll"),
    applicationDate: String(body.applicationDate ?? ""),
    insuredSum: body.insuredSum == null || body.insuredSum === "" ? null : Math.round(Number(body.insuredSum)),
    annualPremium: body.annualPremium == null || body.annualPremium === "" ? null : Math.round(Number(body.annualPremium)),
    paymentMethod: body.paymentMethod ? String(body.paymentMethod) : null,
    relativeName: body.relativeName ? String(body.relativeName).trim() : null,
    eligibilityChecked: body.eligibilityChecked === true,
    department: body.department ? String(body.department).trim() : null,
    recordedBy: body.recordedBy ? String(body.recordedBy).trim() : null,
  };
  const problem = enrollmentProblem(input);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const memberNumber = memberNumberKey(input.memberNumber)!;
  const applicationDate = new Date(`${input.applicationDate}T00:00:00Z`);
  const [roster, coverage, yearEnd] = await Promise.all([
    prisma.memberRoster.findUnique({ where: { memberNumber }, select: { memberName: true, unitName: true } }),
    prisma.memberCoverage.findFirst({
      where: { memberNumber, snapshot: { isCurrent: true } },
      select: { memberName: true, unitName: true, age: true },
    }),
    prisma.appSetting.findUnique({ where: { key: POLICY_YEAR_END_KEY } }),
  ]);

  const life = input.product === "life" && input.action === "enroll";
  const created = await prisma.coverageEnrollment.create({
    data: {
      memberNumber,
      memberName: roster?.memberName ?? coverage?.memberName ?? (body.memberName ? String(body.memberName).trim() : null),
      unitName: roster?.unitName ?? coverage?.unitName ?? null,
      age: coverage?.age ?? null,
      product: input.product,
      action: input.action,
      applicationDate,
      insuredSum: life ? input.insuredSum : null,
      annualPremium: life ? input.annualPremium : null,
      proratedPremium: life && input.annualPremium ? proratedPremium(input.annualPremium, applicationDate, yearEnd?.value ?? null) : null,
      paymentMethod: life ? input.paymentMethod : null,
      relativeName: input.product === "relative" ? input.relativeName : null,
      eligibilityChecked: input.eligibilityChecked,
      department: input.department,
      recordedBy: input.recordedBy,
      note: body.note ? String(body.note).trim() || null : null,
    },
  });
  return NextResponse.json(created);
}
