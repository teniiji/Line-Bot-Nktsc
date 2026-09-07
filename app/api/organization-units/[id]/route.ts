import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LINE_TARGET_FORMAT_ERROR, lineTargetKind } from "@/lib/lineGroups";

// Edits one unit's contact details.
//
// Unlike MemberRoster.lineUserId — which staff may only ever clear, because
// there it is an identity binding the bot checks against impersonation —
// lineUserId here is freely settable. It points at the staff member on the
// receiving end of that unit's รายการหัก, so entering one is exactly the
// intended use, and nothing is granted by being named here beyond receiving
// the file the cooperative was going to send anyway.
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json();

  const data: {
    contactName?: string | null;
    email?: string | null;
    lineUserId?: string | null;
    contactMethod?: string | null;
    note?: string | null;
  } = {};

  // Every field is optional and blank clears it, so a unit that genuinely has
  // no email is recorded as having none rather than keeping a stale address.
  for (const field of ["contactName", "email", "lineUserId", "contactMethod", "note"] as const) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "string") {
      return NextResponse.json({ error: `${field} must be a string` }, { status: 400 });
    }
    const trimmed = (body[field] as string).trim();
    data[field] = trimmed === "" ? null : trimmed;
  }

  // A unit's รายการหัก can go to one person or to the unit's own group. The
  // shape is still checked — it catches a display name or a half-copied id at
  // the point of entry rather than as a failed send halfway through a round —
  // but a group id ("C…") is now as valid as a personal one ("U…"), which is
  // what lets a unit whose finance officer changes keep receiving its file.
  if (data.lineUserId && !lineTargetKind(data.lineUserId)) {
    return NextResponse.json({ error: LINE_TARGET_FORMAT_ERROR }, { status: 400 });
  }

  if (data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
    return NextResponse.json({ error: "รูปแบบอีเมลไม่ถูกต้อง" }, { status: 400 });
  }

  try {
    const unit = await prisma.organizationUnit.update({
      where: { id: params.id },
      data,
      select: {
        id: true,
        name: true,
        groupName: true,
        contactName: true,
        email: true,
        lineUserId: true,
        contactMethod: true,
        note: true,
      },
    });
    return NextResponse.json(unit);
  } catch {
    return NextResponse.json({ error: "ไม่พบหน่วยงานนี้" }, { status: 404 });
  }
}
