import { Prisma } from "@prisma/client";
import { lineClient } from "./lineClient";
import { prisma } from "./prisma";

// Called on every message so we eventually have a display name for every
// user, but only actually hits LINE's profile API (and the DB write) the
// first time we see a given user — cheap on every later message.
export async function ensureLineUser(lineUserId: string): Promise<void> {
  const existing = await prisma.lineUser.findUnique({
    where: { id: lineUserId },
    select: { id: true },
  });
  if (existing) return;

  let displayName: string | null = null;
  try {
    const profile = await lineClient.getProfile(lineUserId);
    displayName = profile.displayName ?? null;
  } catch (err) {
    console.error("[lineUsers] getProfile error:", err);
  }

  try {
    await prisma.lineUser.create({ data: { id: lineUserId, displayName } });
  } catch (err) {
    // Two concurrent events for a brand-new user both racing past the
    // findUnique check above is expected, not an error — the loser just
    // hits the id's primary key constraint.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
      throw err;
    }
  }
}
