import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Takes a file off the round's upload list. Only the list: what the file
// recorded on members stays — undo/route.ts takes that back, where it can.
export async function DELETE(_request: Request, { params }: { params: { id: string; uploadId: string } }) {
  const upload = await prisma.statementFileUpload.findFirst({
    where: { id: params.uploadId, roundId: params.id },
    select: { id: true },
  });
  if (!upload) return NextResponse.json({ error: "ไม่พบไฟล์นี้ในรอบ" }, { status: 404 });
  await prisma.statementFileUpload.delete({ where: { id: upload.id } });
  return NextResponse.json({ ok: true });
}
