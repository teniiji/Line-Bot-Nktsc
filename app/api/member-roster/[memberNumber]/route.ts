import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseNationalId, parsePhone } from "@/lib/identityFormat";

// Staff-only edit of the two identity-verification fields (see
// lib/memberLookup.ts) — deliberately not exposed anywhere the member
// themselves can reach, since these are exactly the fields the bot checks
// before revealing a member's เลขสมาชิก. A member reporting a phone change
// must go through staff here, never a self-service bot flow.
export async function PUT(
  request: NextRequest,
  { params }: { params: { memberNumber: string } }
) {
  const body = await request.json();
  const { nationalId, phone } = body;

  if (nationalId !== undefined && typeof nationalId !== "string") {
    return NextResponse.json({ error: "nationalId must be a string" }, { status: 400 });
  }
  if (phone !== undefined && typeof phone !== "string") {
    return NextResponse.json({ error: "phone must be a string" }, { status: 400 });
  }

  const data: { nationalId?: string | null; phone?: string | null } = {};

  if (nationalId !== undefined) {
    const trimmed = nationalId.trim();
    if (trimmed === "") {
      data.nationalId = null;
    } else {
      const parsed = parseNationalId(trimmed);
      if (!parsed) {
        return NextResponse.json(
          { error: "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก" },
          { status: 400 }
        );
      }
      data.nationalId = parsed;
    }
  }

  if (phone !== undefined) {
    const trimmed = phone.trim();
    if (trimmed === "") {
      data.phone = null;
    } else {
      const parsed = parsePhone(trimmed);
      if (!parsed) {
        return NextResponse.json(
          { error: "เบอร์โทรต้องเป็นตัวเลข 9-10 หลัก" },
          { status: 400 }
        );
      }
      data.phone = parsed;
    }
  }

  try {
    const member = await prisma.memberRoster.update({
      where: { memberNumber: params.memberNumber },
      data,
      select: {
        id: true,
        memberNumber: true,
        memberName: true,
        unitName: true,
        nationalId: true,
        phone: true,
      },
    });
    return NextResponse.json(member);
  } catch {
    return NextResponse.json({ error: "ไม่พบสมาชิก" }, { status: 404 });
  }
}
