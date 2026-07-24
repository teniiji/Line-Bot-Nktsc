import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// Unlike LineUsersPanel's roster (which is small and safe to browse
// unfiltered), MemberRoster holds every member of the cooperative — require
// a real search term instead of allowing a full-table browse from the
// dashboard.
const MIN_SEARCH_LENGTH = 2;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() ?? "";

  if (search.length < MIN_SEARCH_LENGTH) {
    return NextResponse.json({ data: [], total: 0, page: 1, pageSize: PAGE_SIZE });
  }

  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(searchParams.get("pageSize")) || PAGE_SIZE)
  );

  const where = {
    OR: [
      { memberNumber: { contains: search, mode: "insensitive" as const } },
      { memberName: { contains: search, mode: "insensitive" as const } },
    ],
  };

  const [data, total] = await Promise.all([
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
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.memberRoster.count({ where }),
  ]);

  return NextResponse.json({ data, total, page, pageSize });
}
