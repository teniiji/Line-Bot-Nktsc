import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// One round with every unit's row, joined to that unit's contact details so
// the table can show how each one is reachable — a unit with neither a LINE
// id nor an email can never be sent to from here, and staff need to see that
// before they wonder why the button is missing.
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const round = await prisma.deductionRound.findUnique({ where: { id: params.id } });
  if (!round) {
    return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });
  }

  const files = await prisma.deductionUnitFile.findMany({
    where: { roundId: round.id },
    orderBy: { unitName: "asc" },
  });

  // unitName is a plain string, not a relation — batch-fetch the units and
  // join in memory rather than one query per row.
  const units = await prisma.organizationUnit.findMany({
    where: { name: { in: files.map((f) => f.unitName) } },
    select: {
      name: true,
      groupName: true,
      contactName: true,
      email: true,
      lineUserId: true,
      contactMethod: true,
    },
  });
  const unitByName = new Map(units.map((u) => [u.name, u]));

  const data = files.map((f) => {
    const unit = unitByName.get(f.unitName);
    return {
      id: f.id,
      unitName: f.unitName,
      groupName: unit?.groupName ?? null,
      contactName: unit?.contactName ?? null,
      email: unit?.email ?? null,
      // The id itself is never sent to the browser — only whether one exists.
      // It's a staff member's LINE account, and the table only needs to answer
      // "can this be sent over LINE".
      hasLineId: Boolean(unit?.lineUserId),
      contactMethod: unit?.contactMethod ?? null,
      fileName: f.fileName,
      fileUrl: f.filePath ? `/api/blob/${f.filePath}` : null,
      amount: f.amount,
      memberCount: f.memberCount,
      sendStatus: f.sendStatus,
      sentAt: f.sentAt,
      sentVia: f.sentVia,
      sendError: f.sendError,
    };
  });

  return NextResponse.json({ round, data });
}

// Close/reopen a round, or edit its label/note. Closing is deliberately
// reversible and never deletes anything: a finished month stays on record.
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json();
  const data: { label?: string; note?: string | null; closedAt?: Date | null } = {};

  if (body.label !== undefined) {
    if (typeof body.label !== "string" || !body.label.trim()) {
      return NextResponse.json({ error: "ชื่อรอบห้ามว่าง" }, { status: 400 });
    }
    data.label = body.label.trim();
  }
  if (body.note !== undefined) {
    data.note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
  }
  if (body.closed !== undefined) {
    if (typeof body.closed !== "boolean") {
      return NextResponse.json({ error: "closed must be a boolean" }, { status: 400 });
    }
    data.closedAt = body.closed ? new Date() : null;
  }

  try {
    const round = await prisma.deductionRound.update({ where: { id: params.id }, data });
    return NextResponse.json(round);
  } catch {
    return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });
  }
}

// Deleting a round drops its per-unit rows with it (no FK cascade exists —
// these are plain string references), so do it explicitly rather than leaving
// orphans behind. Intended for a round created by mistake; a real month
// should be closed instead.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.deductionUnitFile.deleteMany({ where: { roundId: params.id } });
    await prisma.deductionRound.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });
  }
}
