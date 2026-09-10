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
  // A binding whose LINE account no longer exists. Every id in the roster
  // became meaningless the day the cooperative moved to a new OA — a LINE
  // userId is scoped to the channel that issued it — and a stale one does not
  // merely fail to help: the impersonation guard sees a binding that does not
  // match the account the member is messaging from and refuses their
  // transaction. That is the outage the 20260728120000_clear_stale_line_links
  // migration had to clean up. Finding them needs a difference between two
  // tables that have no relation between them (see the schema's convention),
  // so it is computed rather than expressed as a where clause.
  if (linked === "stale") {
    const [bound, known] = await Promise.all([
      prisma.memberRoster.findMany({
        where: { NOT: { lineUserId: null } },
        select: { lineUserId: true },
      }),
      prisma.lineUser.findMany({ select: { id: true } }),
    ]);
    const knownIds = new Set(known.map((row) => row.id));
    const staleIds = bound
      .map((row) => row.lineUserId)
      .filter((id): id is string => Boolean(id) && !knownIds.has(id as string));
    // An empty IN matches nothing, which is the right answer: no stale links.
    filters.push({ lineUserId: { in: staleIds } });
  }

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

  // Which LINE account each binding points at, so the row can name it instead
  // of only saying that one exists — and so a binding pointing at nothing can
  // say so, which is the one case that needs acting on.
  const boundIds = rows
    .map((row) => row.lineUserId)
    .filter((id): id is string => Boolean(id));
  const lineUsers = boundIds.length
    ? await prisma.lineUser.findMany({
        where: { id: { in: boundIds } },
        select: { id: true, displayName: true, nickname: true },
      })
    : [];
  const lineUserById = new Map(lineUsers.map((row) => [row.id, row]));

  const data = rows.map((row) => {
    const account = row.lineUserId ? (lineUserById.get(row.lineUserId) ?? null) : null;
    return {
    ...row,
    nationalId: browsing ? maskNationalId(row.nationalId) : row.nationalId,
    // Said explicitly so the panel can label a masked value as masked rather
    // than let it read as what is stored.
    nationalIdMasked: browsing && Boolean(row.nationalId),
    bankAccounts: accountsByMember.get(row.memberNumber) ?? [],
    // The nickname the member set through the bot wins over the LINE profile
    // name: staff who know a member as "ครูแดง" are looking for that.
    lineDisplayName: account ? (account.nickname ?? account.displayName) : null,
    // False for a binding that points at an account this app has no record
    // of — see the stale filter above.
    lineAccountExists: row.lineUserId === null ? false : account !== null,
    };
  });

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
