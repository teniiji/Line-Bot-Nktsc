import { prisma } from "./prisma";
import { withCollateral, type CoverageRates, type CoverageRow } from "./coverage";

// Loading a coverage round with its collateral worked out.
//
// A round is one membership's worth of rows (a few thousand), and every view of
// it — the cards, the age table, the filtered list, the export — needs all of
// them added up under the round's own rates. Reading the round once and doing
// the arithmetic in one place (lib/coverage.ts) keeps every one of those
// figures the same answer to the same question.

export async function currentSnapshot(id?: string | null) {
  if (id) return prisma.coverageSnapshot.findUnique({ where: { id } });
  return (
    (await prisma.coverageSnapshot.findFirst({ where: { isCurrent: true }, orderBy: { createdAt: "desc" } })) ??
    (await prisma.coverageSnapshot.findFirst({ orderBy: { createdAt: "desc" } }))
  );
}

export function ratesOf(s: CoverageRates): CoverageRates {
  return {
    benefitSok: s.benefitSok,
    benefitScs: s.benefitScs,
    benefitSst: s.benefitSst,
    benefitSsk: s.benefitSsk,
    welfarePerPeriod: s.welfarePerPeriod,
    welfareCap: s.welfareCap,
  };
}

export async function loadCoverageRows(snapshotId: string, rates: CoverageRates): Promise<CoverageRow[]> {
  const members = await prisma.memberCoverage.findMany({ where: { snapshotId } });

  // The roster is the canonical name and unit; the file's own spelling is the
  // fallback for members the roster does not carry.
  // Asked in slices: Postgres caps the parameters one statement can bind.
  const numbers = members.map((m) => m.memberNumber);
  const roster: { memberNumber: string; memberName: string; unitName: string | null }[] = [];
  for (let i = 0; i < numbers.length; i += 1000) {
    roster.push(
      ...(await prisma.memberRoster.findMany({
        where: { memberNumber: { in: numbers.slice(i, i + 1000) } },
        select: { memberNumber: true, memberName: true, unitName: true },
      }))
    );
  }
  const byMember = new Map(roster.map((r) => [r.memberNumber, r]));

  return members.map((m) => {
    const r = byMember.get(m.memberNumber);
    return withCollateral(
      {
        memberNumber: m.memberNumber,
        memberName: r?.memberName ?? m.memberName,
        unitName: m.unitName ?? r?.unitName ?? null,
        gender: m.gender,
        age: m.age,
        sharePeriods: m.sharePeriods,
        shares: Number(m.shares),
        debt: m.debt == null ? null : Number(m.debt),
        insuredSum: m.insuredSum,
        premium: m.premium,
        premiumDeducted: m.premiumDeducted,
        hasSok: m.hasSok,
        hasScs: m.hasScs,
        hasSst: m.hasSst,
        hasSsk: m.hasSsk,
        relativeCount: m.relativeCount,
        relativeFees: m.relativeFees,
        debtStatus: m.debtStatus,
        undeducted: m.undeducted,
      },
      rates
    );
  });
}
