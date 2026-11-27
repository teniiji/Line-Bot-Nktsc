import { prisma } from "./prisma";
import {
  filterCoverage,
  parseFilters,
  sortCoverage,
  withCollateral,
  type CoverageInput,
  type CoverageRates,
  type CoverageRow,
  type CoverageSort,
} from "./coverage";

export const COVERAGE_SORTS: CoverageSort[] = ["margin", "debt", "insured", "age", "member"];
import { applyEnrollments } from "./coverageEnrollments";
import { applyShareReport } from "./shareDebt";

// The date applications are counted from: the share-and-debt date the file
// was made at, or its import when it has none.
export const enrollmentsSince = (s: { asOf: Date | null; createdAt: Date }) => s.asOf ?? s.createdAt;

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

// The latest สสค. member list: who belongs in their own right, and the
// benefit it pays.
export async function latestSscRoster() {
  const roster = await prisma.associationRoster.findFirst({
    where: { association: "ssc" },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, benefit: true, asOf: true, memberCount: true, createdAt: true },
  });
  if (!roster) return null;
  const members = await prisma.associationRosterMember.findMany({ where: { rosterId: roster.id }, select: { memberNumber: true } });
  return { ...roster, members: new Set(members.map((m) => m.memberNumber)) };
}

// The round's rates with สสค.'s benefit added.
export function ratesWithSsc(s: CoverageRates, ssc: { benefit: number } | null): CoverageRates {
  return { ...ratesOf(s), benefitSsc: ssc?.benefit ?? 0 };
}

// The share-and-debt report to lay over a round: the latest one, as long as
// it is not older than the round's own figures.
export async function shareReportFor(s: { asOf: Date | null }) {
  return prisma.shareDebtReport.findFirst({
    where: s.asOf ? { asOf: { gte: s.asOf } } : {},
    orderBy: [{ asOf: "desc" }, { createdAt: "desc" }],
    select: { id: true, label: true, asOf: true, memberCount: true, debtColumns: true },
  });
}

async function shareEntries(reportId: string) {
  const entries = await prisma.shareDebtEntry.findMany({
    where: { reportId },
    select: { memberNumber: true, shares: true, debt: true, sharePeriods: true },
  });
  return new Map(
    entries.map((e) => [
      e.memberNumber,
      {
        shares: e.shares == null ? null : Number(e.shares),
        debt: e.debt == null ? null : Number(e.debt),
        sharePeriods: e.sharePeriods,
      },
    ])
  );
}

// since: lay the applications recorded after this date over the file (the
// tab's default); null shows the file as it was imported.
// shareReportId: then lay that month's shares and debt over the result, so
// members who applied since the file get their figures too.
export async function loadCoverageRows(
  snapshotId: string,
  rates: CoverageRates,
  since: Date | null = null,
  shareReportId: string | null = null,
  sscMembers: Set<string> | null = null
): Promise<CoverageRow[]> {
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

  const inputs: CoverageInput[] = members.map((m) => {
    const r = byMember.get(m.memberNumber);
    return (
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
      }
    );
  });

  const withShares = async (rows: CoverageInput[]) => {
    const out: CoverageInput[] = shareReportId ? applyShareReport(rows, await shareEntries(shareReportId)) : rows;
    if (sscMembers) for (const m of out) m.hasSsc = sscMembers.has(m.memberNumber);
    return out;
  };

  if (!since) return (await withShares(inputs)).map((m) => withCollateral(m, rates));
  const events = await prisma.coverageEnrollment.findMany({
    where: { applicationDate: { gt: since }, status: { not: "rejected" } },
    select: {
      memberNumber: true,
      memberName: true,
      unitName: true,
      age: true,
      product: true,
      action: true,
      status: true,
      applicationDate: true,
      insuredSum: true,
      annualPremium: true,
    },
  });
  return (await withShares(applyEnrollments(inputs, events, since))).map((m) => withCollateral(m, rates));
}

// A round's rows as the coverage list shows them, filtered and sorted by the
// same query string: the list, its export and the shortfall file all read
// the same members.
export async function queryCoverage(searchParams: URLSearchParams) {
  const snapshot = await currentSnapshot(searchParams.get("snapshot"));
  if (!snapshot) return null;
  // shares=0 shows the file's own shares and debt.
  const shareReport = await shareReportFor(snapshot);
  const applyShares = !!shareReport && searchParams.get("shares") !== "0";
  const ssc = await latestSscRoster();
  const rows = await loadCoverageRows(
    snapshot.id,
    ratesWithSsc(snapshot, ssc),
    searchParams.get("enrollments") === "0" ? null : enrollmentsSince(snapshot),
    applyShares ? shareReport.id : null,
    ssc?.members ?? null
  );
  const filtered = filterCoverage(rows, parseFilters(searchParams));
  const sortParam = searchParams.get("sort") as CoverageSort | null;
  const sorted = sortCoverage(filtered, sortParam && COVERAGE_SORTS.includes(sortParam) ? sortParam : "margin");
  // The date the shares and debt are as of.
  const figuresAsOf = applyShares ? shareReport.asOf : (snapshot.asOf ?? snapshot.createdAt);
  return { snapshot, rows, sorted, figuresAsOf };
}
