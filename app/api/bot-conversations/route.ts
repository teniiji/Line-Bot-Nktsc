import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildThreads, filterThreads, type ThreadFilter, type ThreadMember } from "@/lib/botConversations";
import { QUOTED_RETENTION_MS } from "@/lib/quotedMessage";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
// A fortnight of a busy OA is a few thousand rows; past this the oldest drop.
const MAX_ROWS = 5000;
const FILTERS: ThreadFilter[] = ["all", "waiting", "unanswered", "failed", "noInfo"];

// GET /api/bot-conversations?days=7&filter=all&search=&page=1
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const maxDays = Math.round(QUOTED_RETENTION_MS / 86_400_000);
  const days = Math.min(maxDays, Math.max(1, Number(params.get("days")) || 7));
  const filterParam = params.get("filter") as ThreadFilter | null;
  const filter = filterParam && FILTERS.includes(filterParam) ? filterParam : "all";
  const search = params.get("search") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);

  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.quotableMessage.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS,
  });

  const ids = Array.from(new Set(rows.map((r) => r.lineUserId)));
  const users = ids.length
    ? await prisma.lineUser.findMany({
        where: { id: { in: ids } },
        select: { id: true, displayName: true, fullName: true, memberNumber: true },
      })
    : [];
  const numbers = users.map((u) => u.memberNumber).filter((n): n is string => !!n);
  const roster = numbers.length
    ? await prisma.memberRoster.findMany({
        where: { memberNumber: { in: numbers } },
        select: { memberNumber: true, memberName: true },
      })
    : [];
  const rosterName = new Map(roster.map((r) => [r.memberNumber, r.memberName]));
  const members = new Map<string, ThreadMember & { displayName: string | null }>(
    users.map((u) => [
      u.id,
      {
        name: (u.memberNumber && rosterName.get(u.memberNumber)) || u.fullName || u.displayName,
        memberNumber: u.memberNumber,
        displayName: u.displayName,
      },
    ])
  );

  const handoffs = ids.length
    ? await prisma.staffHandoff.findMany({
        where: { lineUserId: { in: ids }, createdAt: { gte: since } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const threads = buildThreads(rows, members, handoffs);
  const counts = Object.fromEntries(
    FILTERS.map((f) => [f, f === "all" ? threads.length : threads.filter((t) => t[f] > 0).length])
  );
  const matching = filterThreads(threads, filter, search);
  const pageThreads = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((t) => ({
    ...t,
    displayName: members.get(t.lineUserId)?.displayName ?? null,
  }));

  return NextResponse.json({
    days,
    maxDays,
    truncated: rows.length === MAX_ROWS,
    counts,
    total: matching.length,
    page,
    pageSize: PAGE_SIZE,
    threads: pageThreads,
  });
}
