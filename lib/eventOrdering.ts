// Which of a webhook delivery's events may run at the same time.
//
// One delivery can carry several events, and they used to all be started at
// once with Promise.all. For two different members that is correct and worth
// keeping — they touch nothing in common. For two events from the *same*
// member it is not: both runs read that member's pending transaction, both
// decide what to do with it, and both write. The member sees the result.
//
// From a real conversation, two replies posted in the same minute:
//
//   "ยอดเงินในสลิปคือ 500,000.00 บาท ซึ่งไม่ตรงกับยอดที่แจ้งไว้ก่อนหน้านี้ (29,054.00)"
//   "ยอดเงิน 29,054.00 บาท แต่ดิฉันสังเกตว่ายอดนี้ไม่ตรงกับยอดที่แจ้งไว้ก่อนหน้า (500,000.00)"
//
// Each run quoted, as the amount "previously on record", the value the other
// had just written. Whichever finished last is what the member was left with.
//
// So events are grouped by who sent them: the groups run in parallel, and
// within a group one at a time, in the order LINE delivered them.

// What a source counts as, for the purpose of "must not overlap". A group
// chat is keyed by the group, not by the member who spoke in it: two people
// posting in the same group produce events that touch the same LineGroup row.
export function conversationKeyOf(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const s = source as { type?: string; userId?: string; groupId?: string; roomId?: string };
  if (s.type === "group" && s.groupId) return `group:${s.groupId}`;
  if (s.type === "room" && s.roomId) return `room:${s.roomId}`;
  if (s.userId) return `user:${s.userId}`;
  return null;
}

// Splits events into runs that must not overlap. Order within each run is the
// order they arrived; an event whose source cannot be identified gets a run of
// its own, since there is nothing to say what it might collide with.
export function groupBySource<T>(
  events: T[],
  sourceOf: (event: T) => unknown
): T[][] {
  const byKey = new Map<string, T[]>();
  const ungrouped: T[][] = [];

  for (const event of events) {
    const key = conversationKeyOf(sourceOf(event));
    if (key === null) {
      ungrouped.push([event]);
      continue;
    }
    const run = byKey.get(key);
    if (run) run.push(event);
    else byKey.set(key, [event]);
  }

  return [...byKey.values(), ...ungrouped];
}
