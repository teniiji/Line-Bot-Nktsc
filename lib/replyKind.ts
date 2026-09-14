// Why the last reply was sent, so the next one can decide whether it has
// anything to add.
//
// A member sent five photos of a ceremony. LINE delivers an album as five
// separate message events, each one its own run of the agent with no
// knowledge of the other four, so each decided the picture was not a slip and
// each answered. The member got four messages in a row saying the same thing
// in four different ways — and the fourth also claimed the photo had been
// sent before, which was not true.
//
// The words varied because recentReplyNote asks the model not to repeat
// itself, and it obeyed. That was the wrong remedy: the problem was never the
// wording. There was nothing more to say, and the bot had no way to say
// nothing — every event ended in a message, always.
//
// So a reply now carries what it was, and a reply that would repeat a kind
// with nothing to add is not sent at all. Deliberately not text similarity:
// two replies rewritten around the same non-answer are not textually alike,
// and two that genuinely differ can be. What the reply was for is exact.
//
// Only kinds that are a non-answer belong here. A confirmation of a slip is
// never suppressed, however many arrive together: three slips in one album
// are three payments and the member needs three answers.

export type ReplyKind =
  // The picture was not a slip and nothing suggests the member was trying to
  // send one, so the reply asked what they needed. Asking again, of the next
  // photo in the same album, is noise: the question is already on screen and
  // unanswered, and staff can see the conversation.
  | "asked-what-they-need"
  // The member asked something only the cooperative can answer — whether a
  // payment date can be moved, whether something is approved, a figure that
  // depends on their own account. Nothing here is sent at all.
  | "left-to-staff"
  | null;

// Kinds that are never sent, as against kinds that are only withheld when
// they would repeat themselves.
//
// A member asked whether she could pay on Monday because she was on official
// duty in Khon Kaen until Friday. The bot cannot decide that — nobody in this
// system can — so it wrote ten lines: four phone numbers, an email address,
// and a suggested workaround, none of which was the answer. This is a staffed
// channel. The answer to a question the bot cannot answer is for the person
// who can to answer it, and anything the bot says first is in the way.
const NEVER_SENT = new Set<ReplyKind>(["left-to-staff"]);

export const alwaysSilent = (kind: ReplyKind): boolean => NEVER_SENT.has(kind);

// How long a kind stays answered. Long enough to cover a member adding more
// photos to what is, to them, one message; short enough that someone who
// comes back later gets a reply rather than silence. The same ten minutes
// lib/repeatReport.ts settled on for the same shape of question.
export const REPEAT_SILENCE_WINDOW_MS = 10 * 60 * 1000;

export interface LastReply {
  kind: ReplyKind;
  at: Date;
}

// True when this reply repeats one already on the member's screen and adds
// nothing to it.
export function repeatsLastReply(
  previous: LastReply | null,
  kind: ReplyKind,
  now: Date
): boolean {
  if (kind === null || !previous || previous.kind !== kind) return false;

  const age = now.getTime() - previous.at.getTime();
  // A negative age is clock skew between the app and the database, not a
  // reply from the future — and skew must never be a reason to stay silent.
  if (age < 0) return false;
  return age <= REPEAT_SILENCE_WINDOW_MS;
}
