// Moving a bank line recorded on the เงินเข้าประจำวัน page to the member it
// really belongs to, when staff put it on the wrong person (27439: a unit's
// ฿30,960.75 recorded for her; the results file then said payroll could not
// deduct from her at all, so the unit had nothing of hers to send). The
// recording, the round row it put on the member, and the unit's memory of
// who it pays for all named the wrong person; this is the one step that
// moves all three — see lib/lineReassignStore.ts.

export interface ReassignState {
  fromMember: string | null;
  toMember: string;
  // Rows cut from the recording's round row ("แบ่งให้สมาชิกอื่น" /
  // "ตัดยอดออก"): the line is already divided, and moving it whole would
  // leave them behind.
  pieces: number;
  // Part of the line already paying a carried debt (ชำระข้ามเดือน) — that
  // payment names the old member's debt.
  carried: boolean;
  // A round holding it that has been closed.
  closedRound: string | null;
}

export function reassignProblem(s: ReassignState): string | null {
  if (!s.toMember) return "ต้องระบุเลขสมาชิกที่จะย้ายไปให้";
  if (s.fromMember === s.toMember) return "รายการนี้บันทึกเป็นของสมาชิกคนนี้อยู่แล้ว";
  if (s.carried) {
    return 'ยอดนี้บางส่วนใช้ชำระหนี้ข้ามเดือนไปแล้ว — ลบรายการชำระนั้นที่แถบ "ชำระข้ามเดือน" ก่อน';
  }
  if (s.closedRound) return `รอบ ${s.closedRound} ที่นับยอดนี้ปิดไปแล้ว — ต้องเปิดรอบอีกครั้งก่อน`;
  if (s.pieces > 0) {
    return "ยอดนี้ถูกแบ่งหรือตัดบางส่วนในรอบแล้ว — รวมกลับก่อน แล้วค่อยย้ายทั้งก้อน";
  }
  return null;
}

// Whether the old member's place on the unit's list came from this very
// line, and so goes with it. A member the unit has paid for before at some
// other amount, or who came in with a linked office, stays: they may well be
// the unit's too, and this recording is not what says so.
export function learnedFromLine(
  entry: { lastAmount: number | null; viaOffice: string | null },
  lineAmount: number
): boolean {
  return entry.viaOffice === null && entry.lastAmount !== null && Math.abs(entry.lastAmount - lineAmount) < 0.005;
}
