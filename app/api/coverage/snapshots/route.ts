import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshots = await prisma.coverageSnapshot.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { members: true } } },
  });
  return NextResponse.json({ data: snapshots });
}
