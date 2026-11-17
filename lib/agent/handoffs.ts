// The database and LINE side of handing a member's message to staff — see
// lib/staffHandoff.ts for what is sent and why.
import { prisma } from "../prisma";
import { lineClient } from "../lineClient";
import { summarisePushFailures } from "../pushError";
import { DEPARTMENTS } from "../departments";
import { lineTargetKind } from "../lineGroups";
import {
  AFTER_HOURS_ACK_ENABLED,
  departmentNotifyKey,
  isFeatureEnabled,
} from "../featureFlags";
import {
  AFTER_HOURS_ACK,
  alreadyClaimedReply,
  claimedForOthers,
  claimedReply,
  dueForReminder,
  handoffNoticeMessage,
  isHandoffKind,
  isOfficeHours,
  memberLabel,
  needsNewNotice,
} from "../staffHandoff";
import { allPlanTargets, pushToPlan, pushToTargets, resolveForwardPlan } from "./forwarding";
import { loadLineUser } from "./state";
import type { ToolContext } from "./types";

export interface LeaveToStaffInput {
  reason?: unknown;
  kind?: unknown;
  department?: unknown;
}

// What the model is told after leave_to_staff, whatever happened to the
// notice: its text is discarded either way.
export const LEFT_TO_STAFF_RESULT =
  "Acknowledged. NOTHING you write will be sent to the member — this message is being left for staff, who read this chat. Do not write an apology, a holding reply, or a promise that someone will be in touch: there is no message. Reply with a single full stop and stop.";

export async function leaveToStaff(input: LeaveToStaffInput, ctx: ToolContext): Promise<string> {
  const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : "ไม่ได้ระบุ";
  const kind = isHandoffKind(input.kind) ? input.kind : "unclear";
  const department =
    typeof input.department === "string" && (DEPARTMENTS as readonly string[]).includes(input.department)
      ? input.department
      : "อื่นๆ";
  console.log(`[agent] leaving this one to staff (${kind}, ${department}): ${reason}`);
  ctx.noteReplyKind("left-to-staff");

  try {
    await notifyStaff(ctx, { reason, kind, department });
  } catch (err) {
    // The member's message is still in chat.line.biz; a failed notice must
    // not turn the turn into an error reply.
    console.error("[agent] staff handoff notice failed:", err);
  }
  return LEFT_TO_STAFF_RESULT;
}

async function notifyStaff(
  ctx: ToolContext,
  { reason, kind, department }: { reason: string; kind: string; department: string }
): Promise<void> {
  const now = new Date();
  const latest = await prisma.staffHandoff.findFirst({
    where: { lineUserId: ctx.lineUserId },
    orderBy: { createdAt: "desc" },
    select: { status: true, createdAt: true, claimedAt: true },
  });
  if (!needsNewNotice(latest, now)) {
    console.log("[agent] staff already notified about this member — no new notice");
    return;
  }

  const [lineUser, profile] = await Promise.all([
    loadLineUser(ctx.lineUserId),
    prisma.lineUser.findUnique({ where: { id: ctx.lineUserId }, select: { displayName: true } }),
  ]);
  const handoff = await prisma.staffHandoff.create({
    data: {
      lineUserId: ctx.lineUserId,
      memberName: lineUser?.fullName ?? null,
      memberNumber: lineUser?.memberNumber ?? null,
      kind,
      department,
      reason,
    },
  });

  if (!isOfficeHours(now) && (await isFeatureEnabled(AFTER_HOURS_ACK_ENABLED))) {
    ctx.noteHoldingReply(AFTER_HOURS_ACK);
  }

  const result = await pushNotice(handoff, profile?.displayName ?? null, 0);
  await prisma.staffHandoff.update({ where: { id: handoff.id }, data: result });
}

type HandoffRow = NonNullable<Awaited<ReturnType<typeof prisma.staffHandoff.findUnique>>>;

async function pushNotice(
  handoff: HandoffRow,
  displayName: string | null,
  reminder: number
): Promise<{ notifiedTo: string | null; notifyError: string | null }> {
  if (handoff.department && !(await isFeatureEnabled(departmentNotifyKey(handoff.department)))) {
    return { notifiedTo: null, notifyError: "muted" };
  }
  const plan = await resolveForwardPlan(handoff.lineUserId, handoff.department);
  if (allPlanTargets(plan).length === 0) {
    console.warn("[agent] no forward target configured — staff handoff not notified");
    return { notifiedTo: null, notifyError: "unconfigured" };
  }
  const { succeededIds, errors } = await pushToPlan(
    plan,
    [handoffNoticeMessage({ ...handoff, displayName }, reminder)],
    reminder > 0 ? "staff handoff reminder" : "staff handoff notice"
  );
  return {
    notifiedTo: succeededIds.length ? succeededIds.join(",") : null,
    notifyError: summarisePushFailures(errors),
  };
}

// ---- Claiming -------------------------------------------------------------

async function officerName(userId: string | null, groupId: string | null): Promise<string> {
  if (!userId) return "เจ้าหน้าที่";
  const contact = await prisma.departmentContact.findFirst({
    where: { lineUserId: userId, name: { not: null } },
    select: { name: true },
  });
  if (contact?.name) return contact.name;
  try {
    const profile = groupId
      ? await lineClient.getGroupMemberProfile(groupId, userId)
      : await lineClient.getProfile(userId);
    return profile.displayName || "เจ้าหน้าที่";
  } catch {
    return "เจ้าหน้าที่";
  }
}

// The officer tapped รับเรื่องนี้. Returns the text to reply with in the chat
// the tap came from; the other officers who got the notice one-to-one are
// told separately (a group sees the reply itself).
export async function claimHandoff(
  id: string,
  officer: { userId: string | null; groupId: string | null; chatId: string }
): Promise<string> {
  const handoff = await prisma.staffHandoff.findUnique({ where: { id } });
  if (!handoff) return "ไม่พบเรื่องนี้ในระบบแล้ว";
  const displayName = (
    await prisma.lineUser.findUnique({ where: { id: handoff.lineUserId }, select: { displayName: true } })
  )?.displayName;
  const member = memberLabel({ ...handoff, displayName: displayName ?? null });

  const by = await officerName(officer.userId, officer.groupId);
  const { count } = await prisma.staffHandoff.updateMany({
    where: { id, status: "open" },
    data: { status: "claimed", claimedBy: by, claimedByLineUserId: officer.userId, claimedAt: new Date() },
  });
  if (count === 0) {
    const current = await prisma.staffHandoff.findUnique({ where: { id } });
    return alreadyClaimedReply(current?.claimedBy ?? null, current?.claimedAt ?? null, member);
  }

  const others = (handoff.notifiedTo ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((to) => to && to !== officer.chatId && lineTargetKind(to) === "user");
  if (others.length) {
    await pushToTargets(others, [{ type: "text", text: claimedForOthers(by, member) }], "staff handoff claimed");
  }
  return claimedReply(by, member);
}

// ---- Reminders ------------------------------------------------------------

// Run from the webhook at most every few minutes per instance: there is no
// scheduler here, and in office hours members message often enough.
let lastReminderCheck = 0;
const REMINDER_CHECK_EVERY_MS = 5 * 60 * 1000;

export async function sendDueHandoffReminders(now = new Date()): Promise<void> {
  if (now.getTime() - lastReminderCheck < REMINDER_CHECK_EVERY_MS) return;
  lastReminderCheck = now.getTime();
  if (!isOfficeHours(now)) return;

  const open = await prisma.staffHandoff.findMany({
    where: { status: "open", createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } },
    take: 50,
  });
  for (const handoff of open.filter((h) => dueForReminder(h, now))) {
    // Claimed for the reminder first, so two instances never both send it.
    const { count } = await prisma.staffHandoff.updateMany({
      where: { id: handoff.id, status: "open", reminderCount: handoff.reminderCount },
      data: { reminderCount: { increment: 1 }, remindedAt: now },
    });
    if (count === 0) continue;
    const displayName = (
      await prisma.lineUser.findUnique({ where: { id: handoff.lineUserId }, select: { displayName: true } })
    )?.displayName;
    const result = await pushNotice(handoff, displayName ?? null, handoff.reminderCount + 1);
    if (result.notifyError) {
      await prisma.staffHandoff.update({ where: { id: handoff.id }, data: { notifyError: result.notifyError } });
    }
  }
}

// Marked from the dashboard by staff who answered without tapping the button.
export async function claimFromDashboard(id: string): Promise<boolean> {
  const { count } = await prisma.staffHandoff.updateMany({
    where: { id, status: "open" },
    data: { status: "claimed", claimedBy: "เจ้าหน้าที่ (แดชบอร์ด)", claimedAt: new Date() },
  });
  return count > 0;
}
