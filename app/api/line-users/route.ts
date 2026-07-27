import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Unlike some other API routes, this one previously read no request data,
// so Next.js would otherwise try to statically prerender it at build time
// and hit the database before one exists. Still true now that it reads
// searchParams (those don't affect prerendering), so kept for safety.
export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const search = searchParams.get("search")?.trim();
  const where: Record<string, unknown> = search
    ? {
        OR: [
          { displayName: { contains: search, mode: "insensitive" } },
          { nickname: { contains: search, mode: "insensitive" } },
          { id: { contains: search, mode: "insensitive" } },
          { memberNumber: { contains: search, mode: "insensitive" } },
        ],
      }
    : {};

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
          select: { memberNumber: true, unitName: true },
        })
      : [];
  const unitByMemberNumber = new Map(rosterEntries.map((r) => [r.memberNumber, r.unitName]));

  const data = rows.map((r) => ({
    ...r,
    unitName: r.memberNumber ? unitByMemberNumber.get(r.memberNumber) ?? null : null,
  }));

  return NextResponse.json({ data, total, page, pageSize });
}
