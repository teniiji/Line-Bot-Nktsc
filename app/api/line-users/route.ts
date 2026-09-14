import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Unlike some other API routes, this one previously read no request data,
// so Next.js would otherwise try to statically prerender it at build time
// and hit the database before one exists. Still true now that it reads
// searchParams (those don't affect prerendering), so kept for safety.
export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// Shared with PATCH below so "ปิดทั้งหมด" bulk-pauses exactly the set of
// people the search box is currently showing (every matching page, not just
// the one on screen) instead of drifting from what GET actually returns.
async function buildLineUserWhere(
  search: string | undefined
): Promise<Record<string, unknown>> {
  if (!search) return {};

  // The roster's name is shown in this table, so it has to be searchable from
  // it — a name on screen that the box above it cannot find is worse than no
  // name. MemberRoster is a different table, so the member numbers it matches
  // are resolved first and folded into the same OR. One extra query, only
  // when somebody is actually searching.
  const rosterMatches = await prisma.memberRoster.findMany({
    where: { memberName: { contains: search, mode: "insensitive" } },
    select: { memberNumber: true },
    take: 500,
  });

  return {
    OR: [
      { displayName: { contains: search, mode: "insensitive" } },
      { nickname: { contains: search, mode: "insensitive" } },
      { id: { contains: search, mode: "insensitive" } },
      { memberNumber: { contains: search, mode: "insensitive" } },
      // What the member typed, which is what this table showed before the
      // roster's spelling was joined in and is still the only name for
      // anyone the roster has never heard of.
      { fullName: { contains: search, mode: "insensitive" } },
      ...(rosterMatches.length
        ? [{ memberNumber: { in: rosterMatches.map((r) => r.memberNumber) } }]
        : []),
    ],
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const search = searchParams.get("search")?.trim();
  const where = await buildLineUserWhere(search);

  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(searchParams.get("pageSize")) || DEFAULT_PAGE_SIZE)
  );

  const [rows, total] = await Promise.all([
    prisma.lineUser.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        displayName: true,
        nickname: true,
        fullName: true,
        memberNumber: true,
        botPaused: true,
        createdAt: true,
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.lineUser.count({ where }),
  ]);

  // สังกัด (unitName) isn't stored on LineUser itself — MemberRoster is the
  // canonical source, keyed by memberNumber (which LineUser only gets once
  // a member has gone through report_transaction's identity step). One
  // batched lookup for the whole page instead of N+1 findUnique calls.
  const memberNumbers = rows
    .map((r) => r.memberNumber)
    .filter((n): n is string => n !== null);
  const rosterEntries =
    memberNumbers.length > 0
      ? await prisma.memberRoster.findMany({
          where: { memberNumber: { in: memberNumbers } },
          select: { memberNumber: true, unitName: true, memberName: true },
        })
      : [];
  const unitByMemberNumber = new Map(rosterEntries.map((r) => [r.memberNumber, r.unitName]));
  // The name was always in this row. Only the unit was being taken out of it,
  // so a member the roster knows well enough to name their unit still showed
  // a dash where their name goes.
  const nameByMemberNumber = new Map(rosterEntries.map((r) => [r.memberNumber, r.memberName]));

  const data = rows.map((r) => ({
    ...r,
    unitName: r.memberNumber ? unitByMemberNumber.get(r.memberNumber) ?? null : null,
    rosterName: r.memberNumber ? nameByMemberNumber.get(r.memberNumber) ?? null : null,
    // Why สังกัด is blank, which a dash cannot say. "No member number yet" and
    // "that number is not in the roster" need completely different actions —
    // one is a member the bot never identified, the other is very likely a
    // typo — and has() is what tells them apart, since a roster row can exist
    // with no unit name of its own.
    inRoster: r.memberNumber ? unitByMemberNumber.has(r.memberNumber) : false,
  }));

  return NextResponse.json({ data, total, page, pageSize });
}

// Bulk-set botPaused for everyone matching the current search (or literally
// everyone, with no search box text) — "ปิดทั้งหมด"/"เปิดทั้งหมด" in the
// dashboard, for when staff need to silence the bot for a whole list at once
// instead of clicking every row. A single updateMany instead of looping the
// client's one loaded page: LineUsersPanel only ever holds PAGE_SIZE rows,
// far fewer than the real table.
//
// Deliberately a different lever from `messaging_enabled` (ตั้งค่าระบบ):
// that flag silences every reply system-wide, including to people who
// message for the first time after it's flipped. This only touches
// existing LineUser rows, so someone who messages for the first time after
// a bulk pause still gets a normal reply — matching what the button says
// ("ปิดทั้งหมด" for the people listed here, not a maintenance-mode switch).
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { botPaused, search } = body;

  if (typeof botPaused !== "boolean") {
    return NextResponse.json({ error: "botPaused must be a boolean" }, { status: 400 });
  }
  if (search !== undefined && typeof search !== "string") {
    return NextResponse.json({ error: "search must be a string" }, { status: 400 });
  }

  const where = await buildLineUserWhere(search?.trim());
  const result = await prisma.lineUser.updateMany({ where, data: { botPaused } });

  return NextResponse.json({ count: result.count });
}
