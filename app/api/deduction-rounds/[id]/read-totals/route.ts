import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { readFirstSheetRows } from "@/lib/excelUpload";
import { deductionFileTotal } from "@/lib/deductionFileTotal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reads the total off every file in this round that was uploaded before the
// upload route learned to (lib/deductionFileTotal.ts), from the stored copy —
// so a file already in place does not have to be uploaded again, which would
// also reset it to ยังไม่ส่ง.
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const round = await prisma.deductionRound.findUnique({ where: { id: params.id } });
  if (!round) return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });

  const files = await prisma.deductionUnitFile.findMany({
    where: { roundId: round.id, filePath: { not: null }, amount: null },
  });
  let read = 0;
  const unreadable: string[] = [];
  for (const file of files) {
    try {
      const blob = await get(file.filePath as string, { access: "private" });
      if (!blob || blob.statusCode !== 200) throw new Error("not found");
      const bytes = await new Response(blob.stream).arrayBuffer();
      const total = deductionFileTotal(await readFirstSheetRows(new File([bytes], file.fileName ?? "file.xlsx")));
      if (!total || total.amount === null) throw new Error("no amount column");
      await prisma.deductionUnitFile.update({
        where: { id: file.id },
        data: { amount: total.amount, memberCount: total.memberCount },
      });
      read += 1;
    } catch (err) {
      console.warn(`[deduction-rounds] read total ${file.unitName}:`, err);
      unreadable.push(file.unitName);
    }
  }
  return NextResponse.json({ read, unreadable });
}
