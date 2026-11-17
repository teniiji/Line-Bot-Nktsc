// A member's message the bot leaves to staff (leave_to_staff): a request for
// an exception, a complaint about money, or something it cannot make out.
//
// The bot used to go quiet on these and tell nobody, so the most sensitive
// messages in the OA were the ones that depended on someone happening to open
// chat.line.biz. Now the responsible officer — the department's group, or the
// member's own loan officer — gets a short notice: who, what about, and a
// "รับเรื่องนี้" button. Deliberately not the conversation itself: the reply
// can only be written in chat.line.biz anyway, and a complaint's details have
// no business sitting in several officers' personal LINE.
//
// LINE never tells the bot what staff type in chat.line.biz, so "has anyone
// answered?" cannot be read off the chat. The button is how it is known: the
// officer who taps it owns the message, the others are told, and a notice
// nobody has claimed after two working hours is sent again.

import type { messagingApi } from "@line/bot-sdk";
import { COOPERATIVE_OFFSET_MS, cooperativeDateTime } from "./cooperativeClock";

export const HANDOFF_KINDS = {
  exception: "ขออนุมัติ / ขอยกเว้น / ขอผ่อนผัน",
  money_dispute: "ร้องเรียนหรือสอบถามเรื่องเงินของตัวเอง",
  unclear: "บอทไม่แน่ใจว่าสมาชิกหมายถึงอะไร",
} as const;
export type HandoffKind = keyof typeof HANDOFF_KINDS;

export const isHandoffKind = (value: unknown): value is HandoffKind =>
  typeof value === "string" && value in HANDOFF_KINDS;

// ---- Office hours ----------------------------------------------------------
// Monday to Friday, 08:30-16:30 Bangkok time. Public holidays are not known
// here: a holiday weekday counts as a working day.
export const OFFICE_OPEN_MIN = 8 * 60 + 30;
export const OFFICE_CLOSE_MIN = 16 * 60 + 30;
export const OFFICE_HOURS_LABEL = "จันทร์–ศุกร์ 08:30–16:30 น.";

const DAY_MS = 24 * 60 * 60 * 1000;
const isWeekday = (bangkok: Date) => bangkok.getUTCDay() >= 1 && bangkok.getUTCDay() <= 5;

export function isOfficeHours(now: Date): boolean {
  const local = new Date(now.getTime() + COOPERATIVE_OFFSET_MS);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  return isWeekday(local) && minute >= OFFICE_OPEN_MIN && minute < OFFICE_CLOSE_MIN;
}

// Working minutes between two instants: a notice left at 16:00 on Friday has
// waited 30 working minutes by Monday 08:30, not a weekend.
export function workingMinutesBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  const start = from.getTime() + COOPERATIVE_OFFSET_MS;
  const end = to.getTime() + COOPERATIVE_OFFSET_MS;
  let total = 0;
  // At most two months of days; anything older is long overdue regardless.
  for (let day = Math.floor(start / DAY_MS) * DAY_MS, n = 0; day < end && n < 62; day += DAY_MS, n++) {
    if (!isWeekday(new Date(day))) continue;
    const open = Math.max(start, day + OFFICE_OPEN_MIN * 60_000);
    const close = Math.min(end, day + OFFICE_CLOSE_MIN * 60_000);
    if (close > open) total += (close - open) / 60_000;
  }
  return Math.round(total);
}

// ---- When to notify --------------------------------------------------------
// A member rarely sends one message: "โอนแล้วไม่เข้า", "ช่วยดูหน่อย", "ด่วนค่ะ"
// is three handoffs to the bot, and three notices would be noise. One notice
// stands while it is open (up to half a day) and for a few hours after an
// officer has claimed it — that officer is in the chat and sees the rest.
export const OPEN_NOTICE_WINDOW_MS = 12 * 60 * 60 * 1000;
export const CLAIMED_NOTICE_WINDOW_MS = 4 * 60 * 60 * 1000;

export interface HandoffState {
  status: string;
  createdAt: Date;
  claimedAt: Date | null;
}

export function needsNewNotice(latest: HandoffState | null, now: Date): boolean {
  if (!latest) return true;
  if (latest.status === "open") {
    return now.getTime() - latest.createdAt.getTime() > OPEN_NOTICE_WINDOW_MS;
  }
  const since = (latest.claimedAt ?? latest.createdAt).getTime();
  return now.getTime() - since > CLAIMED_NOTICE_WINDOW_MS;
}

// ---- Reminders -------------------------------------------------------------
export const REMIND_AFTER_WORKING_MIN = 120;
export const MAX_REMINDERS = 2;

export interface ReminderState {
  status: string;
  createdAt: Date;
  remindedAt: Date | null;
  reminderCount: number;
}

export function dueForReminder(h: ReminderState, now: Date): boolean {
  return (
    h.status === "open" &&
    h.reminderCount < MAX_REMINDERS &&
    isOfficeHours(now) &&
    workingMinutesBetween(h.remindedAt ?? h.createdAt, now) >= REMIND_AFTER_WORKING_MIN
  );
}

// ---- The notice ------------------------------------------------------------
const CLAIM_PREFIX = "handoff:claim:";
export const claimPostbackData = (id: string) => `${CLAIM_PREFIX}${id}`;
export function parseClaimPostback(data: string | undefined | null): string | null {
  if (!data?.startsWith(CLAIM_PREFIX)) return null;
  const id = data.slice(CLAIM_PREFIX.length).trim();
  return id || null;
}

export interface HandoffNotice {
  id: string;
  memberName: string | null;
  memberNumber: string | null;
  displayName: string | null;
  kind: string;
  department: string | null;
  reason: string;
  createdAt: Date;
}

export function memberLabel(h: Pick<HandoffNotice, "memberName" | "memberNumber" | "displayName">): string {
  const name = h.memberName || h.displayName || "สมาชิก (ยังไม่ทราบชื่อ)";
  return h.memberNumber ? `${name} (เลขสมาชิก ${h.memberNumber})` : name;
}

const kindLabel = (kind: string) => (isHandoffKind(kind) ? HANDOFF_KINDS[kind] : kind);
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// reminder: how many times this notice has been sent before (0 = first).
export function handoffNoticeMessage(h: HandoffNotice, reminder = 0): messagingApi.FlexMessage {
  const title = reminder > 0 ? "⏰ ยังไม่มีใครรับเรื่องนี้" : "🔔 มีสมาชิกรอคำตอบใน LINE OA";
  const who = memberLabel(h);
  const line = (text: string, extra: Partial<messagingApi.FlexText> = {}): messagingApi.FlexText => ({
    type: "text",
    text: text || "-",
    wrap: true,
    size: "sm",
    ...extra,
  });
  return {
    type: "flex",
    altText: clip(`${title}: ${who} — ${kindLabel(h.kind)}`, 400),
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          line(title, { weight: "bold", size: "md" }),
          line(who, { weight: "bold" }),
          line(`ประเภท: ${kindLabel(h.kind)}`),
          ...(h.department ? [line(`แผนก: ${h.department}`)] : []),
          line(`เรื่อง: ${clip(h.reason, 300)}`),
          line(
            reminder > 0
              ? `ส่งมาเมื่อ ${cooperativeDateTime(h.createdAt)} — ตอบใน chat.line.biz แล้วกดรับเรื่อง`
              : "👉 ตอบสมาชิกใน chat.line.biz — กดรับเรื่องเพื่อให้คนอื่นรู้ว่ามีคนดูแลแล้ว",
            { size: "xs", color: "#64748b" }
          ),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#06C755",
            action: {
              type: "postback",
              label: "รับเรื่องนี้",
              data: claimPostbackData(h.id),
              displayText: "รับเรื่องนี้ค่ะ/ครับ",
            },
          },
        ],
      },
    },
  };
}

export const claimedReply = (by: string, member: string) =>
  `✅ ${by} รับเรื่องของ ${member} แล้ว — ตอบสมาชิกใน chat.line.biz ได้เลย`;
export const claimedForOthers = (by: string, member: string) =>
  `✅ ${by} รับเรื่องของ ${member} แล้ว ไม่ต้องตอบซ้ำ`;
export const alreadyClaimedReply = (by: string | null, at: Date | null, member: string) =>
  `เรื่องของ ${member} ${by ?? "เจ้าหน้าที่"} รับไปแล้ว${at ? `เมื่อ ${cooperativeDateTime(at)}` : ""}`;

// Sent to the member, once per notice, when it arrives outside office hours:
// otherwise a message on a Saturday night meets silence until Monday.
export const AFTER_HOURS_ACK =
  `ได้รับข้อความแล้วค่ะ ขณะนี้อยู่นอกเวลาทำการ (${OFFICE_HOURS_LABEL}) ` +
  "เจ้าหน้าที่จะตอบกลับในเวลาทำการถัดไปค่ะ";
