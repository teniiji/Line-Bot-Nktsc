// What staff are told about the account a deposit is going into.
//
// A member sent a ฿50,000 slip for a ฝากเงิน. The bot asked which cooperative
// savings account to pay it into; the member answered with their name, member
// number and the amount — everything except the account — so the bot asked
// again, and again. Two screens of a member trying to answer a question they
// did not have the answer to.
//
// The cooperative's decision is that this must never block: record it, forward
// it, and let staff sort the account out. There is already a switch for that —
// ask_deposit_account_enabled in ตั้งค่าระบบ — which makes the bot skip the
// question entirely.
//
// What the switch did not do is tell anyone. The forwarded message printed
// "เลขที่บัญชีที่ฝาก: X" when the number was known and printed nothing at all
// when it was not, so with the question switched off a deposit reaches staff
// with the account silently missing. A line that disappears is not something a
// person notices in the twentieth message of the morning. Turning the question
// off moves it from the member to staff, so it has to be visible to staff.
export function depositAccountLine(
  category: string,
  depositAccountNumber: string | null
): string {
  if (depositAccountNumber) {
    return `\nเลขที่บัญชีที่ฝาก: ${depositAccountNumber}`;
  }
  // Only ฝากเงิน has an account to be missing. Saying "not given" on a
  // ชำระหนี้ would be noise about a field that never applied.
  if (category === "ฝากเงิน") {
    return "\n⚠️ ไม่ได้แจ้งเลขที่บัญชีที่ฝาก — ต้องสอบถามสมาชิกเพิ่ม";
  }
  return "";
}
