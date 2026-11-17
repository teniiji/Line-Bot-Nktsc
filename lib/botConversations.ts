// The บทสนทนาบอท page: what members wrote to the bot and what it wrote back,
// one thread per member, from the messages the bot keeps (QuotableMessage —
// both sides, a fortnight, see lib/quotedMessage.ts). Staff replies typed in
// chat.line.biz never pass through here, so a member message with no bot
// reply after it is one the bot left to staff (or messaging was paused).

export interface StoredMessage {
  id: string;
  lineUserId: string;
  fromBot: boolean;
  text: string;
  createdAt: Date | string;
}

export interface ThreadMember {
  name: string | null;
  memberNumber: string | null;
}

// A message handed to staff (StaffHandoff), shown in the thread at the time
// it was made, with whether an officer has taken it.
export interface ThreadHandoff {
  id: string;
  lineUserId: string;
  kind: string;
  department: string | null;
  reason: string;
  status: string;
  notifiedTo: string | null;
  notifyError: string | null;
  claimedBy: string | null;
  claimedAt: Date | string | null;
  reminderCount: number;
  createdAt: Date | string;
}

export interface ConversationThread {
  lineUserId: string;
  name: string | null;
  memberNumber: string | null;
  lastAt: string;
  messages: { id: string; fromBot: boolean; text: string; createdAt: string; flag: MessageFlag }[];
  // Member messages the bot did not answer before the member wrote again.
  unanswered: number;
  // Bot replies that were the fallback apology: the model failed or refused.
  failed: number;
  // Bot replies saying it has no such information — gaps in ฐานความรู้.
  noInfo: number;
  handoffs: (Omit<ThreadHandoff, "claimedAt" | "createdAt"> & { claimedAt: string | null; createdAt: string })[];
  // Handoffs no officer has claimed yet.
  waiting: number;
}

export type MessageFlag = "unanswered" | "failed" | "noInfo" | null;

// The replies sent when the model gave nothing usable (financeAgent) or the
// whole turn threw (the webhook).
const FAILED = [/ไม่สามารถตอบได้ในตอนนี้/, /ดำเนินการไม่สำเร็จ ลองใหม่/, /เกิดข้อผิดพลาด ลองใหม่/];
// How the prompt has the bot say a question is outside ฐานความรู้.
const NO_INFO = [/ไม่มีข้อมูล(นี้|เรื่องนี้|ส่วนนี้)?ในระบบ/, /ยังไม่มีข้อมูล(นี้|เรื่องนี้)/];

export function flagOf(message: { fromBot: boolean; text: string }): MessageFlag {
  if (!message.fromBot) return null;
  if (FAILED.some((re) => re.test(message.text))) return "failed";
  if (NO_INFO.some((re) => re.test(message.text))) return "noInfo";
  return null;
}

export function buildThreads(
  rows: StoredMessage[],
  members: Map<string, ThreadMember>,
  handoffRows: ThreadHandoff[] = []
): ConversationThread[] {
  const byUser = new Map<string, StoredMessage[]>();
  for (const row of rows) byUser.set(row.lineUserId, [...(byUser.get(row.lineUserId) ?? []), row]);
  const handoffsOf = new Map<string, ThreadHandoff[]>();
  for (const h of handoffRows) handoffsOf.set(h.lineUserId, [...(handoffsOf.get(h.lineUserId) ?? []), h]);

  const threads: ConversationThread[] = [];
  for (const [lineUserId, list] of byUser) {
    const sorted = [...list].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const messages = sorted.map((m, i) => {
      let flag = flagOf(m);
      // A member message with another member message, not a bot reply, next.
      // The last message of a thread is left alone: its reply may be on the way.
      if (!m.fromBot && i < sorted.length - 1 && !sorted[i + 1].fromBot) flag = "unanswered";
      return { id: m.id, fromBot: m.fromBot, text: m.text, createdAt: new Date(m.createdAt).toISOString(), flag };
    });
    const member = members.get(lineUserId);
    const handoffs = (handoffsOf.get(lineUserId) ?? [])
      .map((h) => ({
        ...h,
        createdAt: new Date(h.createdAt).toISOString(),
        claimedAt: h.claimedAt ? new Date(h.claimedAt).toISOString() : null,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    threads.push({
      lineUserId,
      name: member?.name ?? null,
      memberNumber: member?.memberNumber ?? null,
      lastAt: messages[messages.length - 1].createdAt,
      messages,
      unanswered: messages.filter((m) => m.flag === "unanswered").length,
      failed: messages.filter((m) => m.flag === "failed").length,
      noInfo: messages.filter((m) => m.flag === "noInfo").length,
      handoffs,
      waiting: handoffs.filter((h) => h.status === "open").length,
    });
  }
  return threads.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export type ThreadFilter = "all" | "waiting" | "unanswered" | "failed" | "noInfo";

export function filterThreads(threads: ConversationThread[], filter: ThreadFilter, search: string): ConversationThread[] {
  const needle = search.trim().toLowerCase();
  return threads.filter((t) => {
    if (filter !== "all" && t[filter] === 0) return false;
    if (!needle) return true;
    return (
      (t.name ?? "").toLowerCase().includes(needle) ||
      (t.memberNumber ?? "").toLowerCase().includes(needle) ||
      t.messages.some((m) => m.text.toLowerCase().includes(needle)) ||
      t.handoffs.some((h) => h.reason.toLowerCase().includes(needle))
    );
  });
}
