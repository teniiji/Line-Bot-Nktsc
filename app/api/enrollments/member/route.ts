import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { memberNumberKey } from "@/lib/memberNumber";

export const dynamic = "force-dynamic";

// GET ?q= — members by number or by part of the name, for the รายคน view.
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ data: [] });
  const number = /^\d+$/.test(q) ? memberNumberKey(q) : null;
  const words = q.split(/\s+/).filter(Boolean);
  const data = await prisma.memberRoster.findMany({
    where: number
      ? { memberNumber: { startsWith: number } }
      : { AND: words.map((w) => ({ memberName: { contains: w, mode: "insensitive" as const } })) },
    select: { memberNumber: true, memberName: true, unitName: true },
    orderBy: { memberNumber: "asc" },
    take: 20,
  });
  return NextResponse.json({ data });
}
