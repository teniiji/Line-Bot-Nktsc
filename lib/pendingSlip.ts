// Is this report_transaction call a new payment, or more information about
// the one already being asked about?
//
// The question exists because report_transaction is called for both. A member
// sends a slip; the bot asks what it was for; the member answers and the model
// calls the tool again with just a category. That second call must land on the
// same row.
//
// But a member can also send a second slip before answering — one payment to
// the cooperative and one to ฌาปนกิจสงเคราะห์ is an everyday pair — and that
// call must start its own row. It used to overwrite the first, and the first
// payment disappeared with no trace anywhere but the LINE chat.
//
// The slip's image hash is what tells them apart: it is a SHA-256 of the raw
// bytes, so the same photo sent twice hashes identically and a different photo
// never does.

export interface SlipArrival {
  // The row the bot is currently asking about, if any.
  activeHasSlip: boolean;
  activeSlipHash: string | null;
  // This call.
  incomingHasSlip: boolean;
  incomingSlipHash: string | null;
}

export function startsNewPayment(arrival: SlipArrival): boolean {
  // An answer to a question ("ซื้อหุ้น", an amount, a correction) carries no
  // image and always belongs to the row being asked about.
  if (!arrival.incomingHasSlip) return false;

  // The member described the payment in text first and is only now sending
  // the slip for it. Same payment.
  if (!arrival.activeHasSlip) return false;

  // The same image again — a resend, a retried delivery, the member scrolling
  // up and forwarding their own message. Not a second payment.
  if (
    arrival.incomingSlipHash !== null &&
    arrival.incomingSlipHash === arrival.activeSlipHash
  ) {
    return false;
  }

  // A different slip while one is still unanswered. Two payments.
  return true;
}
