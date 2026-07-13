import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await request.json();
  const { nickname } = body;

  if (nickname !== null && typeof nickname !== "string") {
    return NextResponse.json(
      { error: "nickname must be a string or null" },
      { status: 400 }
    );
  }
  const trimmed = typeof nickname === "string" ? nickname.trim() : null;

  try {
    const user = await prisma.lineUser.update({
      where: { id: params.id },
      data: { nickname: trimmed || null },
      select: { id: true, displayName: true, nickname: true, createdAt: true },
    });
    return NextResponse.json(user);
  } catch {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
}
