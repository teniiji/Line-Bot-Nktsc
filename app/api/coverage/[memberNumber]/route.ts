import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { memberNumberKey } from "@/lib/memberNumber";
import { computeCollateral } from "@/lib/coverage";
import { ratesOf } from "@/lib/coverageStore";

export const dynamic = "force-dynamic";

// One member across every round they appear in, newest first — the detail
// under a row shows this year, and the history shows how it moved.
export async function GET(_request: NextRequest, { params }: { params: { memberNumber: string } }) {
  const key = memberNumberKey(params.memberNumber);
  if (!key) return NextResponse.json({ error: "เลขสมาชิกไม่ถูกต้อง" }, { status: 400 });

  const entries = await prisma.memberCoverage.findMany({
    where: { memberNumber: key },
    include: { snapshot: true },
    orderBy: { snapshot: { createdAt: "desc" } },
  });
  const roster = await prisma.memberRoster.findUnique({
    where: { memberNumber: key },
    select: { memberName: true, unitName: true },
  });

  return NextResponse.json({
    memberNumber: key,
    memberName: roster?.memberName ?? entries[0]?.memberName ?? null,
    unitName: entries[0]?.unitName ?? roster?.unitName ?? null,
    rounds: entries.map((e) => {
      const { snapshot, id, ...rest } = e;
      void id;
      const input = {
        ...rest,
        shares: Number(e.shares),
        debt: e.debt == null ? null : Number(e.debt),
      };
      return {
        label: snapshot.label,
        asOf: snapshot.asOf,
        rates: ratesOf(snapshot),
        ...input,
        ...computeCollateral(input, ratesOf(snapshot)),
      };
    }),
  });
}
