import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { maskNationalId } from "@/lib/memberPrivacy";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() ?? "";
  // Browsing the whole roster is allowed — being unable to see how many
  // members are on file, or page through them, was a real cost. What used to
  // buy safety was the search requirement; now it is buying it from
  // maskNationalId instead, which is the thing actually worth protecting.
  const browsing = search.length === 0;

  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(searchParams.get("pageSize")) || PAGE_SIZE)
  );

  // What is missing is the question this panel is usually opened to answer:
  // who cannot be identity-verified yet, who the bot has never reached, whose
  // account nobody has bound. Each filter is a plain "has / does not have" on
  // one column, combined with AND so they narrow together.
  const missing = searchParams.get("missing") ?? "";
  const linked = searchParams.get("linked") ?? "";
  const unit = searchParams.get("unit")?.trim() ?? "";

  const filters: Record<string, unknown>[] = [];
  if (!browsing) {
    filters.push({
      OR: [
        { memberNumber: { contains: search, mode: "insensitive" as const } },
        { memberName: { contains: search, mode: "insensitive" as const } },
        { unitName: { contains: search, mode: "insensitive" as const } },
      ],
    });
  }
  if (unit) filters.push({ unitName: unit });
  // An empty string counts as missing alongside null: a spreadsheet import
  // that wrote "" for a blank cell leaves a value that is present but useless,
  // and staff chasing holes need to see those rows too.
  if (missing === "nationalId") filters.push({ OR: [{ nationalId: null }, { nationalId: "" }] });
  if (missing === "phone") filters.push({ OR: [{ phone: null }, { phone: "" }] });
  if (linked === "yes") filters.push({ NOT: { lineUserId: null } });
  if (linked === "no") filters.push({ lineUserId: null });

  const where = filters.length > 0 ? { AND: filters } : {};

  const [rows, total] = await Promise.all([
    prisma.memberRoster.findMany({
      where,
      orderBy: { memberNumber: "asc" },
      select: {
        id: true,
        memberNumber: true,
        memberName: true,
        unitName: true,
        nationalId: true,
        phone: true,
        // Which LINE account this member is bound to. Surfaced so staff can
        // see and clear a stale binding — a mismatch here blocks the member
        // from recording transactions (see the PUT handler's comment).
        lineUserId: true,
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.memberRoster.count({ where }),
  ]);

  // The accounts each member on this page has bound, so "who is this member
  // and what do they transfer from" is one lookup rather than two panels in
  // two different tabs. Batched by member number, per the schema's no-relation
  // convention.
  const accounts = rows.length
    ? await prisma.memberBankAccount.findMany({
        where: { memberNumber: { in: rows.map((row) => row.memberNumber) } },
        orderBy: { accountNumber: "asc" },
        select: { memberNumber: true, accountNumber: true },
      })
    : [];
  const accountsByMember = new Map<string, string[]>();
  for (const entry of accounts) {
    const list = accountsByMember.get(entry.memberNumber);
    if (list) list.push(entry.accountNumber);
    else accountsByMember.set(entry.memberNumber, [entry.accountNumber]);
  }

  const data = rows.map((row) => ({
    ...row,
    nationalId: browsing ? maskNationalId(row.nationalId) : row.nationalId,
    // Said explicitly so the panel can label a masked value as masked rather
    // than let it read as what is stored.
    nationalIdMasked: browsing && Boolean(row.nationalId),
    bankAccounts: accountsByMember.get(row.memberNumber) ?? [],
  }));

  // Every unit on file, for the dropdown. Distinct over one indexed-enough
  // column and small — there are tens of units, not thousands — so it is
  // cheaper than making the panel fetch it separately on every render.
  const unitRows = await prisma.memberRoster.findMany({
    where: { NOT: { unitName: null } },
    distinct: ["unitName"],
    orderBy: { unitName: "asc" },
    select: { unitName: true },
  });
  const units = unitRows.map((row) => row.unitName).filter((name): name is string => Boolean(name));

  return NextResponse.json({ data, total, page, pageSize, browsing, units });
}
