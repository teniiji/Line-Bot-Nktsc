// Recording a payment straight from a bank line staff can see but nobody
// claimed.
//
// The daily view's "เงินเข้าที่ไม่รู้ว่าใครโอน" list is money that genuinely
// arrived with no slip behind it. Until now the list was read-only: staff
// could see the rows and had no way to act on them from there. Finding out
// whose money it is happens on the phone, and the answer had nowhere to go.
//
// Two different answers come back from that phone call, and they need two
// different actions:
//
//   ระบุเจ้าของ  — "that account is นาง X's". A fact about an account, good
//                 forever: written to the directory, and every future
//                 transfer from it is recognised without asking again.
//   บันทึกรายการ — "that ฿29,054 was นาง X paying her หักไม่ได้". A fact
//                 about this one payment: written as a transaction, the same
//                 record a slip through the bot would have produced.
//
// They are independent. A counter deposit has no payer account to bind but
// still needs recording; an account can be bound from a payment that was
// already recorded some other way.
//
// This module holds the parts that are decisions rather than plumbing, so
// they can be tested and so the route and the panel cannot drift on what
// counts as a bindable account.

import { CATEGORIES } from "./categories";

// Channels where the digits the statement shows are known to be the paying
// account, and so mean something bound to a member. See MEMBER_CHANNELS in
// statementLines.ts for where the channels come from.
//
// The rest are not refused, only flagged — see accountCaveat below.
const CHANNELS_WITH_PAYER_ACCOUNT = new Set(["transfer", "mobile"]);

// What is doubtful about treating this line's digits as the payer's account.
// A caveat rather than a refusal: the person on the phone knows more about
// the payment than the transaction code does, and a rule that blocks them
// would be worse than one that warns.
//
// "counter" is the case this exists for and the one that is certain: somebody
// walked into a branch and paid in cash, so there is no paying account at
// all, and what the description carries is the branch's own reference for
// that deposit. extractSenderAccount pulls those digits out because it cannot
// tell the two apart from the text — the channel is what tells them apart.
const CHANNEL_CAVEATS: Record<string, string> = {
  counter:
    "รายการฝากที่เคาน์เตอร์ไม่มีบัญชีต้นทาง — ตัวเลขที่เห็นคือเลขอ้างอิงใบฝากของสาขา " +
    "ไม่ใช่เลขบัญชีของใคร ผูกไว้ครั้งหน้าก็ใช้ไม่ได้เพราะจะได้เลขใหม่ทุกครั้ง — " +
    'ปกติควรใช้ "บันทึกรายการ" แทน',
};

const GENERIC_CAVEAT =
  "ยังไม่แน่ใจว่าตัวเลขของช่องทางนี้เป็นเลขบัญชีผู้โอนจริงหรือเป็นเลขอ้างอิงของธนาคาร — " +
  "ผูกได้ถ้ามั่นใจ แต่ถ้าไม่แน่ใจให้ใช้ \"บันทึกรายการ\" อย่างเดียว";

export function senderAccountIsPayer(channel: string): boolean {
  return CHANNELS_WITH_PAYER_ACCOUNT.has(channel);
}

// Why binding this line's account to a member is doubtful, or null when it is
// straightforwardly the payer's own account.
export function accountCaveat(channel: string): string | null {
  if (senderAccountIsPayer(channel)) return null;
  return CHANNEL_CAVEATS[channel] ?? GENERIC_CAVEAT;
}

// The one case that is a refusal rather than a caveat: there are no digits at
// all, so there is nothing to bind whatever staff know.
export function canBindAccount(deposit: { senderAccount: string | null }): boolean {
  return Boolean(deposit.senderAccount);
}

// Reasons a payment must not be recorded from a bank line. Kept here so the
// route and the panel say the same thing.
export function recordProblem(input: { memberNumber: string; category: string }): string | null {
  if (!input.memberNumber.trim()) {
    return "ต้องระบุเลขสมาชิกของคนที่โอนเงินก้อนนี้";
  }
  if (!(CATEGORIES as readonly string[]).includes(input.category)) {
    return "ต้องเลือกว่าเงินก้อนนี้เป็นการชำระอะไร";
  }
  return null;
}

// What the transaction says it is, in the รายการ list where it will sit
// beside transactions members filed themselves. Staff reading that list a
// month later need to know this one came from the statement rather than from
// a slip, and which line it came from — the time and the payer are what let
// them find it in the bank's own export again.
//
// The bank's timestamps hold its wall clock in UTC (see parseStatementDate),
// so the clock is read in UTC too: reading it locally would print a time the
// statement does not show.
export function describeDepositRecord(
  deposit: { postedAt: Date | null; senderAccount: string | null; branch: string },
  note: string | null
): string {
  const parts = ["บันทึกจาก statement โดยเจ้าหน้าที่ (ไม่มีสลิป)"];

  if (deposit.postedAt) {
    parts.push(`เงินเข้า ${deposit.postedAt.toISOString().slice(11, 16)} น.`);
  }
  if (deposit.senderAccount) {
    parts.push(`จากบัญชี ${deposit.senderAccount}`);
  }
  parts.push(`บัญชี ${deposit.branch}`);

  const trimmedNote = note?.trim();
  if (trimmedNote) parts.push(trimmedNote);

  return parts.join(" · ");
}

// Said when somebody records the same bank line twice. It happens: two people
// work the same short list, or one clicks twice. The database refuses it
// (Expense.statementLineId is unique) and this is what the refusal means —
// not an error to retry past, but "somebody already did this one".
export const ALREADY_RECORDED_ERROR =
  "เงินก้อนนี้ถูกบันทึกเป็นรายการไปแล้ว — ถ้าบันทึกผิด ให้ลบรายการเดิมที่แท็บ \"รายการ\" ก่อน";
