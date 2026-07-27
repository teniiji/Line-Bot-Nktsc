import { lineClient } from "./lineClient";
import { prisma } from "./prisma";

// Called on every message so displayName always reflects the member's
// current LINE profile name, not just whatever it was the first time they
// ever messaged (a member can rename themselves in LINE at any point).
// Costs one extra LINE API call per message — acceptable at this bot's
// volume — but never overwrites a known displayName with null just because
// this particular getProfile call failed (LINE API hiccup, rate limit,
// etc.): the update clause is only included when a name actually came
// back. upsert makes the create-or-update atomic, so two concurrent events
// for a brand-new user racing each other is handled by Postgres itself
// instead of a manual find-then-create-and-catch-P2002 dance.
export async function ensureLineUser(lineUserId: string): Promise<void> {
  let displayName: string | null = null;
  try {
    const profile = await lineClient.getProfile(lineUserId);
    displayName = profile.displayName ?? null;
  } catch (err) {
    console.error("[lineUsers] getProfile error:", err);
  }

  await prisma.lineUser.upsert({
    where: { id: lineUserId },
    create: { id: lineUserId, displayName },
    update: displayName !== null ? { displayName } : {},
  });
}
