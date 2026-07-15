import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Unlike the other API routes, this one reads no request data (no
// searchParams, no dynamic segment), so Next.js would otherwise try to
// statically prerender it at build time and hit the database before one
// exists.
export const dynamic = "force-dynamic";

export async function GET() {
  const users = await prisma.lineUser.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, displayName: true, nickname: true, createdAt: true },
  });
  return NextResponse.json(users);
}
