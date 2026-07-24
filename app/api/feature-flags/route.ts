import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEFAULT_FLAGS } from "@/lib/featureFlags";

// Unlike most list routes, this one takes no searchParams and always
// returns every row — still force-dynamic so Next.js doesn't try to
// statically prerender a DB read at build time.
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await prisma.featureFlag.findMany();
  // DB row order isn't meaningful — sort into the same priority order as
  // DEFAULT_FLAGS (global switches first in priority order, then
  // per-department notify flags) so the dashboard doesn't have to know it.
  const order = new Map(DEFAULT_FLAGS.map((f, i) => [f.key, i]));
  const sorted = [...rows].sort(
    (a, b) =>
      (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.key) ?? Number.MAX_SAFE_INTEGER)
  );
  return NextResponse.json(sorted);
}

// Body-based update (not /api/feature-flags/[key]) so a department key like
// "dept_notify_บริหารสำนักงาน/ธุรการ" — which contains a literal "/" — never
// has to be encoded into a URL path segment.
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { key, enabled } = body;

  if (typeof key !== "string" || !key.trim()) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  try {
    const updated = await prisma.featureFlag.update({
      where: { key },
      data: { enabled },
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "ไม่พบสวิตช์นี้" }, { status: 404 });
  }
}
