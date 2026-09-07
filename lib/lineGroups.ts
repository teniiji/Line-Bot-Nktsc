import type { webhook } from "@line/bot-sdk";
import { prisma } from "./prisma";
import { lineClient } from "./lineClient";

// Keeping track of the group chats the bot has been added to.
//
// The bot never takes part in a group: the webhook returns before the agent
// for anything that is not a one-to-one chat, and that stays true. Groups
// exist here only as somewhere to *send* to, so that a notification survives
// the officer who used to receive it going on leave or changing job.
//
// A group id cannot be typed in by hand — it appears only in the events LINE
// sends — so this is the one way a group can ever become a target.

// Everything a message can be pushed to. LINE gives each the same shape — a
// letter saying what it is, then 32 hex characters — and pushMessage's `to`
// takes any of them, which is why forwarding to a group needs no change to
// the sending code at all.
export type LineTargetKind = "user" | "group" | "room";

const TARGET_PREFIXES: Record<string, LineTargetKind> = {
  U: "user",
  C: "group",
  R: "room",
};

// Returns what an id refers to, or null if it is not a LINE id at all.
// Checking the shape catches the common paste mistakes — a display name, a
// half-copied id, the unit's own name — at the point of entry rather than as
// a failed send halfway through a round.
export function lineTargetKind(id: string): LineTargetKind | null {
  if (!/^[UCR][0-9a-f]{32}$/.test(id)) return null;
  return TARGET_PREFIXES[id[0]] ?? null;
}

export const LINE_TARGET_FORMAT_ERROR =
  'ต้องเป็น LINE ID ที่ขึ้นต้นด้วย "U" (รายบุคคล) หรือ "C" (กลุ่ม) ตามด้วยตัวอักษร/ตัวเลข 32 ตัว — ' +
  "รายบุคคลคัดลอกจาก chat.line.biz ส่วนกลุ่มให้เลือกจากรายการกลุ่มที่บอทอยู่";

export interface GroupRef {
  id: string;
  // "group" is a named group chat; "room" is an ad-hoc multi-person chat,
  // which has no name and no summary endpoint.
  kind: "group" | "room";
}

// Pulls the chat id out of an event's source. Returns null for a one-to-one
// chat, which is every event the bot actually answers.
export function groupRefOf(source: webhook.Event["source"]): GroupRef | null {
  if (!source) return null;
  if (source.type === "group") return { id: source.groupId, kind: "group" };
  if (source.type === "room") return { id: source.roomId, kind: "room" };
  return null;
}

// LINE only names group chats; asking about a room, or about a group the
// account may not query, is a normal outcome rather than a failure — the
// chat is still recorded, staff just have to label it themselves.
async function fetchGroupName(ref: GroupRef): Promise<string | null> {
  if (ref.kind !== "group") return null;
  try {
    const summary = await lineClient.getGroupSummary(ref.id);
    return summary.groupName ?? null;
  } catch (err) {
    console.error("[lineGroups] group summary unavailable:", err);
    return null;
  }
}

// Records that the bot is in this chat. Called both when it is added and
// whenever anything is posted, so a group it joined before this existed is
// picked up as soon as somebody speaks — and so a chat it was removed from
// and re-added to stops reading as "removed".
export async function recordGroupSeen(ref: GroupRef, justJoined: boolean): Promise<void> {
  const existing = await prisma.lineGroup.findUnique({ where: { groupId: ref.id } });

  // Only asked for on a join, or when the name is still missing: the summary
  // call costs a round trip against LINE's rate limit, and a group's name
  // rarely changes.
  const name = justJoined || (existing && !existing.name) ? await fetchGroupName(ref) : undefined;

  await prisma.lineGroup.upsert({
    where: { groupId: ref.id },
    create: {
      groupId: ref.id,
      kind: ref.kind,
      name: name ?? null,
    },
    update: {
      kind: ref.kind,
      lastSeenAt: new Date(),
      // Re-added after being removed: the row comes back to life rather than
      // leaving a target that looks dead but works.
      leftAt: null,
      ...(name ? { name } : {}),
      ...(justJoined ? { joinedAt: new Date() } : {}),
    },
  });
}

// The bot was removed. The row is kept and marked instead of deleted, so a
// unit or department whose notifications stopped arriving has an explanation
// on screen rather than a target that has simply vanished.
export async function recordGroupLeft(ref: GroupRef): Promise<void> {
  await prisma.lineGroup.updateMany({
    where: { groupId: ref.id },
    data: { leftAt: new Date() },
  });
}

// Said once, in the group, when the bot is added. Worth the message: without
// it people reasonably assume the bot answers questions here the way it does
// in a private chat, post their own financial details to a room full of
// colleagues, and get no reply.
export const GROUP_JOIN_NOTICE =
  "สวัสดีครับ 🤖 บอทสหกรณ์ออมทรัพย์ครูหนองคาย จำกัด\n\n" +
  "บอทถูกเพิ่มเข้ากลุ่มนี้เพื่อ**ส่งแจ้งเตือน/เอกสารของสหกรณ์**เท่านั้น\n" +
  "• ไม่อ่านและไม่ตอบข้อความในกลุ่ม\n" +
  "• เรื่องส่วนตัว (ส่งสลิป ถามยอด ขอเอกสาร) ให้ทักแชทส่วนตัวกับสหกรณ์เหมือนเดิม\n\n" +
  "ถ้าเพิ่มผิดกลุ่ม นำบอทออกได้เลยครับ";
