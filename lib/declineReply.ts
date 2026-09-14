// What the bot says when a member sends a picture that is not a slip.
//
// A member sent a photo of an envelope. The bot read it correctly and replied:
//
//   "ขออภัยค่ะ รูปที่ส่งมาเป็นซองจดหมาย ไม่ใช่สลิปการโอนเงิน ดิฉันเลยไม่
//    สามารถบันทึกเป็นธุรกรรมได้ค่ะ หากสมาชิกมีสลิปการโอนเงินจริง รบกวนส่ง
//    ภาพสลิปมาใหม่ได้เลยนะคะ"
//
// The first half is right and the second half invents an intention. Nothing
// in that conversation said the member was trying to send a slip — they sent
// a picture of an envelope, which is more likely the start of a question
// ("this arrived, what is it?", "is this the right address?") than a failed
// attempt at filing a payment. Asking for a slip they never had leaves them
// with nowhere to go: the one thing the bot asked for is the one thing they
// cannot produce.
//
// The instruction the tool used to return was "Explain this to the user in
// your reply without inventing extra details", and everything else in the
// prompt is about slips, so "explain" reliably became "ask for the slip
// again". Naming what the reply must do fixes it at the source.
//
// The exception is real: when a transaction is genuinely sitting there
// waiting for its slip, asking again is the correct thing to do. So the two
// cases are told apart by the pending transaction itself, not guessed at.

export interface DeclineContext {
  // Short reason the model gave for declining, e.g. "not a transaction slip".
  reason: string;
  // True when this member has a transaction in progress that is waiting for a
  // slip image — the one case where asking for the slip again is right.
  awaitingSlip: boolean;
}

export function declineReplyInstruction({ reason, awaitingSlip }: DeclineContext): string {
  const base = `Declined: ${reason}.`;

  if (awaitingSlip) {
    return (
      `${base} This member DOES have a transaction in progress that is waiting for its slip, ` +
      "so in your reply, in Thai: say briefly what the picture actually shows, say it cannot be " +
      "recorded as that transaction's slip, and ask them to send the transfer slip for it. " +
      "Do not invent details you cannot see in the image."
    );
  }

  return (
    `${base} Nothing this member has said indicates they were trying to send a transfer slip — ` +
    "there is no transaction in progress waiting for one. So in your reply, in Thai: " +
    "(1) say plainly what the picture actually shows, in the member's own terms; " +
    "(2) ask what they would like to do or what they need help with, and say that staff can see " +
    "this chat and will follow up — an open question with no way forward leaves them stuck. " +
    "Keep it to two or three sentences. " +
    "DO NOT ask them to send a transfer slip, and DO NOT say the picture is not a slip as though " +
    "sending one were the expected next step — they may never have intended to send a payment at " +
    "all, and asking for a slip they do not have leaves them stuck. " +
    "Do not invent details you cannot see in the image, and do not guess at why they sent it or " +
    "what occasion it shows. " +
    // A member sending an album gets one run of this per photo, and one of
    // those runs told them the picture had been sent before. It had not:
    // they were five different photographs. Nothing here can see the earlier
    // ones anyway — the duplicate check is on slip bytes, and covers slips.
    "NEVER say or imply that this picture was sent before, is a repeat, or has already been " +
    "seen — you cannot see the member's earlier images and have no basis for saying so. " +
    "If they answer with something the cooperative handles, continue with the right tool for it."
  );
}
