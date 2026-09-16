// What the daily page already worked out about an account the round calls
// unknown.
//
// The two tabs learn who paid in different ways and neither tells the other.
// เงินเข้าประจำวัน learns it from a person: staff ring round, find out whose
// ฿6,690 it was, and record it — a transaction carrying the member number and
// the bank line it came from. เทียบ Statement learns it from the account
// directory and the round's own sheet, neither of which a recording touches.
//
// So a transfer can read "ตรงกับสลิป · 29819 · ชำระเก็บไม่ได้รายเดือน" on one
// tab and sit in "โอนเข้ามาแต่ไม่พบเจ้าของ" on the other, which is what it did
// — the work was done, twice over, and the round went on asking for it.
//
// This does not change any arithmetic. A recording is a transaction, not a
// binding, and turning it into one behind somebody's back is the kind of
// helpfulness that files money under the wrong name. It surfaces what is
// already known so the person can bind it in one click, through the same path
// as always.

export interface RecordedPayment {
  // The account the money came from, as the bank line named it.
  accountNumber: string;
  memberNumber: string;
  memberName: string | null;
  category: string | null;
  // Newest first is decided by the caller; this is only used to break ties.
  recordedAt: Date;
}

export interface RecordedOwner {
  memberNumber: string;
  memberName: string | null;
  category: string | null;
}

// One answer per account: the most recently recorded, because a member who
// has been told apart from a wrong guess is corrected by recording again.
//
// Rows with no member number say nothing about who owns the account and are
// dropped rather than being offered as an answer of "".
export function ownersFromRecordings(
  payments: RecordedPayment[]
): Map<string, RecordedOwner> {
  const newest = new Map<string, RecordedPayment>();
  for (const payment of payments) {
    if (!payment.memberNumber) continue;
    const held = newest.get(payment.accountNumber);
    if (!held || payment.recordedAt > held.recordedAt) {
      newest.set(payment.accountNumber, payment);
    }
  }

  return new Map(
    [...newest].map(([account, payment]) => [
      account,
      {
        memberNumber: payment.memberNumber,
        memberName: payment.memberName,
        category: payment.category,
      },
    ])
  );
}
