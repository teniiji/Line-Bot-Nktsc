// One conversation, one handler at a time — across separate deliveries.
//
// Grouping a delivery's events (lib/eventOrdering.ts) only orders what
// arrived together. LINE does not wait for a 200 before sending the next
// delivery, and each one is its own serverless invocation, so a member who
// sends an image and then types a line a second later can have two handlers
// running at once in different processes. The agent call takes several
// seconds, so the overlap is wide, and both handlers read-modify-write the
// same PendingTransaction row.
//
// Promise.all ordering cannot see across processes. The database can, so the
// lock lives there.
//
// It is deliberately not a general-purpose lock: it protects one member's
// conversation, it is held for at most as long as a handler can run, and it
// never refuses to handle a message. Dropping a member's message would be a
// worse failure than the race it prevents.

import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

// Never longer than the route's maxDuration (60s): a handler cannot still be
// running after that, so a lock older than this belongs to a process that
// died and is safe to take.
const LOCK_TTL_MS = 60_000;

// How long to wait for the handler in front. Comfortably under the TTL, so a
// waiter still has time to do its own work afterwards.
const LOCK_WAIT_MS = 30_000;
const POLL_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function tryAcquire(key: string): Promise<boolean> {
  // A lock past its expiry belonged to a process that is gone. Clearing it
  // here rather than in a sweep means recovery costs nothing and happens
  // exactly when somebody needs the lock.
  await prisma.conversationLock
    .deleteMany({ where: { key, expiresAt: { lt: new Date() } } })
    .catch(() => {});

  try {
    await prisma.conversationLock.create({
      data: { key, expiresAt: new Date(Date.now() + LOCK_TTL_MS) },
    });
    return true;
  } catch (err) {
    // P2002 is the whole point: somebody else holds it. The primary key is
    // what makes the acquire atomic between processes.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return false;
    }
    // Anything else — the database being unreachable — must not stop a
    // member being answered. Proceed unlocked rather than go silent.
    console.error("[conversationLock] acquire failed, proceeding unlocked:", err);
    return true;
  }
}

// Runs `work` with this conversation held. Always runs it: if the wait times
// out, the handler in front is genuinely still going after 30 seconds, and
// answering the member late-but-racy beats not answering at all.
export async function withConversationLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  let held = false;

  while (!(held = await tryAcquire(key))) {
    if (Date.now() >= deadline) {
      console.warn(
        `[conversationLock] ${key}: still held after ${LOCK_WAIT_MS}ms — running anyway rather than dropping the message`
      );
      break;
    }
    await sleep(POLL_MS);
  }

  try {
    return await work();
  } finally {
    // Released even when the handler threw, so one failure does not make the
    // member wait out the TTL on their next message.
    if (held) {
      await prisma.conversationLock.deleteMany({ where: { key } }).catch(() => {});
    }
  }
}
