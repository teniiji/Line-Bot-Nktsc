import { formatAmount } from "./format";

// What the round already knows about a member, shown on the เงินเข้าประจำวัน
// page the moment their number is typed into "บันทึกรายการ" — before the
// line is recorded, not after. A unit's ฿30,960.75 recorded for a member the
// results file already had as หักได้ครบ, or for one who had already paid,
// was only found out on เทียบ Statement afterwards.

export interface RecordCheck {
  // The round already counts this very bank line (its statement upload read
  // it): recording it here files the transaction and counts nothing again.
  thisLineCounted?: boolean;
  roundLabel: string | null;
  onRound: boolean;
  deductionResult?: string;
  amountDue?: number;
  expectedAmount?: number | null;
  amountPaid?: number;
  // The member's other money for the same amount near this line's date: a
  // row already in the round, or a transaction already recorded.
  sameAmount: { amount: number; date: string; where: "round" | "recorded" }[];
}

export interface RecordCheckNote {
  tone: "ok" | "info" | "warn";
  text: string;
}

const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear() + 543}`;
};

export function recordCheckNotes(c: RecordCheck): RecordCheckNote[] {
  const notes: RecordCheckNote[] = [];
  if (c.roundLabel && c.thisLineCounted) {
    const due = c.amountDue ?? 0;
    const paid = c.amountPaid ?? 0;
    const balance = Math.round((paid - due) * 100) / 100;
    const standing =
      c.deductionResult !== "uncollected"
        ? ""
        : Math.abs(balance) < 0.01
          ? " · ครบ"
          : balance > 0
            ? ` · เกิน ${formatAmount(balance)}`
            : ` · ยังขาด ${formatAmount(-balance)}`;
    notes.push({
      tone: "ok",
      text:
        `✅ ยอดนี้นับในรอบ ${c.roundLabel} แล้ว${standing} — ไม่ต้องบันทึกซ้ำ ` +
        "ถ้าต้องการให้มีในแถบธุรกรรมของสมาชิก บันทึกได้ ระบบไม่นับซ้ำ",
    });
  } else if (!c.roundLabel) {
    notes.push({ tone: "info", text: "ยังไม่มีรอบหักไม่ได้ของเดือนที่เงินเข้า" });
  } else if (!c.onRound) {
    notes.push({ tone: "info", text: `ℹ️ ไม่มีชื่อในรอบ ${c.roundLabel} — ไม่ได้อยู่ในรายชื่อหักไม่ได้เดือนนี้` });
  } else if (c.deductionResult === "collected") {
    notes.push({
      tone: "ok",
      text:
        `✅ ผลการหักรอบ ${c.roundLabel} บอกว่าหักได้ครบแล้ว` +
        (c.expectedAmount ? ` (แจ้งหัก ${formatAmount(c.expectedAmount)})` : "") +
        " — ถ้าเป็นยอดที่หน่วยงานโอน คือเงินก้อนที่หักแล้ว บันทึกได้ ระบบไม่นับซ้ำ",
    });
  } else if (c.deductionResult === "awaiting") {
    notes.push({
      tone: "info",
      text:
        `⏳ รอผลการหักรอบ ${c.roundLabel}` +
        (c.expectedAmount ? ` (แจ้งหัก ${formatAmount(c.expectedAmount)})` : ""),
    });
  } else {
    const due = c.amountDue ?? 0;
    const paid = c.amountPaid ?? 0;
    if (due > 0 && paid >= due - 0.005) {
      notes.push({
        tone: "warn",
        text: `⚠️ รอบ ${c.roundLabel} ชำระครบแล้ว (โอนมาแล้ว ${formatAmount(paid)} จากยอดหักไม่ได้ ${formatAmount(due)}) — ตรวจว่ายอดนี้ไม่ใช่เงินก้อนเดิม`,
      });
    } else {
      notes.push({
        tone: "info",
        text: `❌ ยังค้างในรอบ ${c.roundLabel} ${formatAmount(Math.max(0, due - paid))} — บันทึกเป็นชำระเก็บไม่ได้รายเดือนแล้วจะนับเป็นการชำระ`,
      });
    }
  }
  for (const s of c.sameAmount) {
    notes.push({
      tone: "warn",
      text:
        `⚠️ มียอด ${formatAmount(s.amount)} ของคนนี้แล้ว (${day(s.date)} · ` +
        (s.where === "round" ? "อยู่ในรอบ" : "บันทึกไว้แล้ว") +
        ") — อาจเป็นเงินก้อนเดียวกัน",
    });
  }
  return notes;
}
