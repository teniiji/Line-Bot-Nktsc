import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { memberNumberKey } from "@/lib/memberNumber";
import { applyEnrollments } from "@/lib/coverageEnrollments";
import { currentSnapshot, enrollmentsSince, ratesOf, shareReportFor } from "@/lib/coverageStore";
import { DEFAULT_RATES } from "@/lib/coverage";
import type { CoverageInput } from "@/lib/coverage";

export const dynamic = "force-dynamic";

// Who the number is, and what they hold: the current coverage file, every
// application and cancellation recorded for them, and the two laid together.
// The form uses it to warn of a duplicate; the รายคน view shows all of it.
export async function GET(_request: NextRequest, { params }: { params: { memberNumber: string } }) {
  const memberNumber = memberNumberKey(decodeURIComponent(params.memberNumber));
  if (!memberNumber) return NextResponse.json({ error: "เลขสมาชิกไม่ถูกต้อง" }, { status: 400 });
  const [roster, coverage, enrollments] = await Promise.all([
    prisma.memberRoster.findUnique({ where: { memberNumber }, select: { memberName: true, unitName: true } }),
    prisma.memberCoverage.findFirst({
      where: { memberNumber, snapshot: { isCurrent: true } },
      include: { snapshot: true },
    }),
    prisma.coverageEnrollment.findMany({
      where: { memberNumber },
      orderBy: [{ applicationDate: "desc" }, { createdAt: "desc" }],
      take: 200,
    }),
  ]);

  // What the member holds today: the yearly file with the applications
  // since laid over it, the same picture the coverage tab shows.
  const snapshot = coverage?.snapshot ?? (await currentSnapshot());
  const since = snapshot ? enrollmentsSince(snapshot) : new Date(0);
  const fileRow: CoverageInput | null = coverage
    ? {
        memberNumber,
        memberName: coverage.memberName,
        unitName: coverage.unitName,
        gender: coverage.gender,
        age: coverage.age,
        sharePeriods: coverage.sharePeriods,
        shares: Number(coverage.shares),
        debt: coverage.debt == null ? null : Number(coverage.debt),
        insuredSum: coverage.insuredSum,
        premium: coverage.premium,
        premiumDeducted: coverage.premiumDeducted,
        hasSok: coverage.hasSok,
        hasScs: coverage.hasScs,
        hasSst: coverage.hasSst,
        hasSsk: coverage.hasSsk,
        relativeCount: coverage.relativeCount,
        relativeFees: coverage.relativeFees,
        debtStatus: coverage.debtStatus,
        undeducted: coverage.undeducted,
      }
    : null;
  const current =
    applyEnrollments(
      fileRow ? [fileRow] : [],
      enrollments.map((e) => ({ ...e, applicationDate: e.applicationDate })),
      since
    )[0] ?? null;

  // The latest month's shares and debt, when a report has been imported.
  const report = await shareReportFor({ asOf: snapshot?.asOf ?? null });
  const shareEntry = report
    ? await prisma.shareDebtEntry.findUnique({
        where: { reportId_memberNumber: { reportId: report.id, memberNumber } },
        select: { shares: true, debt: true, sharePeriods: true, contracts: true, memberName: true },
      })
    : null;

  return NextResponse.json({
    memberNumber,
    name: roster?.memberName ?? coverage?.memberName ?? enrollments[0]?.memberName ?? shareEntry?.memberName ?? null,
    unitName: roster?.unitName ?? coverage?.unitName ?? enrollments[0]?.unitName ?? null,
    inRoster: !!roster,
    coverage,
    current,
    since,
    snapshot: snapshot ? { label: snapshot.label, asOf: snapshot.asOf } : null,
    // The round's amounts per association and welfare rate, for คำนวณก่อนกู้.
    rates: snapshot ? ratesOf(snapshot) : DEFAULT_RATES,
    shares: shareEntry
      ? {
          label: report!.label,
          asOf: report!.asOf,
          shares: shareEntry.shares == null ? null : Number(shareEntry.shares),
          debt: shareEntry.debt == null ? null : Number(shareEntry.debt),
          sharePeriods: shareEntry.sharePeriods,
          // Each loan contract, when the report was the printed PDF.
          contracts: Array.isArray(shareEntry.contracts) ? shareEntry.contracts : null,
        }
      : null,
    enrollments,
  });
}
