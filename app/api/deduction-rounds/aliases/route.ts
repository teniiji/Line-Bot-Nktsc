import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// File and folder names staff have uploaded each unit's รายการหัก under —
// see DeductionFileAlias and keysToRemember in lib/deductionFileMatch.ts.
export async function GET() {
  const rows = await prisma.deductionFileAlias.findMany({ select: { key: true, unitName: true } });
  return NextResponse.json({ data: rows });
}

// body: { aliases: [{ key, unitName }] } — what one bulk upload settled.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const aliases = (Array.isArray(body.aliases) ? body.aliases : [])
    .map((a: { key?: unknown; unitName?: unknown }) => ({
      key: typeof a?.key === "string" ? a.key.trim() : "",
      unitName: typeof a?.unitName === "string" ? a.unitName.trim() : "",
    }))
    .filter((a: { key: string; unitName: string }) => a.key && a.unitName)
    .slice(0, 1000);
  for (const a of aliases) {
    await prisma.deductionFileAlias.upsert({
      where: { key: a.key },
      create: a,
      update: { unitName: a.unitName },
    });
  }
  return NextResponse.json({ saved: aliases.length });
}
