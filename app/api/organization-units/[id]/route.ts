import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

  // A LINE userId is always "U" plus 32 hex characters. Checking the shape
  // catches the common paste mistakes — a display name, a partial copy, the
  // unit's own name — at the point of entry, instead of surfacing as a failed
  // send halfway through a round.
  if (data.lineUserId && !/^U[0-9a-f]{32}$/.test(data.lineUserId)) {
    return NextResponse.json(
      {
        error:
          'LINE UserID ต้องขึ้นต้นด้วย "U" ตามด้วยตัวอักษร/ตัวเลข 32 ตัว — คัดลอกมาจาก chat.line.biz ให้ครบ',
      },
      { status: 400 }
    );
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
