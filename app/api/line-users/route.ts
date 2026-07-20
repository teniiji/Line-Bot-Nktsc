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
        ],
      }
    : {};

  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(searchParams.get("pageSize")) || DEFAULT_PAGE_SIZE)
  );

  const [data, total] = await Promise.all([
    prisma.lineUser.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: { id: true, displayName: true, nickname: true, createdAt: true },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.lineUser.count({ where }),
  ]);

  return NextResponse.json({ data, total, page, pageSize });
}
