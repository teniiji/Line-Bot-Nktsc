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
  // What else this member still owes, that the payment could be for instead
  // of the month it arrived in: an earlier round still open where they are
  // หักไม่ได้ and short, or a carried debt (ชำระข้ามเดือน) from a closed one.
  // 30047: ฿4,870 arriving in October, for a member October was still
  // awaiting a result on, paid for a month already gone.
  otherOwed?: RecordTarget[];
  // Who the number is, from the member register (or, for a member the
  // register lacks, the round's own list) — so staff see the person they are
  // recording for before saving, not a bare number. 31744 typed into the
  // form said nothing about who that was.
  member?: RecordMember | null;
}

export interface RecordMember {
  name: string | null;
  unitName: string | null;
  // In the member register at all; false when only the round knows the name.
  inRoster: boolean;
  // Linked to the cooperative's LINE OA.
  onLine: boolean;
  // From the register, to call about the payment.
  phone?: string | null;
  // Bank accounts bound to the member (ทะเบียนเลขบัญชี, and the account the
  // round has on file); `paidFrom` marks the one this line came from.
  accounts?: { accountNumber: string; paidFrom: boolean }[];
}

export interface RecordTarget {
  kind: "round" | "debt";
  id: string;
  label: string;
  owed: number;
}

// The value the form sends for a target, and back.
export const recordTargetValue = (t: { kind: string; id: string }) => `${t.kind}:${t.id}`;
export function parseRecordTarget(value: unknown): { kind: "round" | "debt"; id: string } | null {
  const match = /^(round|debt):(.+)$/.exec(typeof value === "string" ? value : "");
  return match ? { kind: match[1] as "round" | "debt", id: match[2] } : null;
}

export interface RecordCheckNote {
  tone: "ok" | "info" | "warn";
  text: string;
}

const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear() + 543}`;
};

// Who the member is, as the first note: name and สังกัด, or that the number
// is in no register — the cue to type the name in, or to recheck the number.
export function memberNote(m: RecordMember | null | undefined): RecordCheckNote | null {
  if (m === undefined) return null;
  if (!m || !m.name) {
    return { tone: "warn", text: "⚠️ ไม่พบเลขสมาชิกนี้ในทะเบียนสมาชิก — ตรวจเลขอีกครั้ง หรือใส่ชื่อในช่องถัดไป" };
  }
  const parts = [`👤 ${m.name}`];
  if (m.unitName) parts.push(m.unitName);
  if (m.onLine) parts.push("เชื่อม LINE แล้ว");
  if (!m.inRoster) parts.push("(ชื่อจากรายชื่อในรอบ ยังไม่มีในทะเบียนสมาชิก)");
  return { tone: m.inRoster ? "ok" : "info", text: parts.join(" · ") };
}

// The member's phone and bound accounts, on a line of their own under the
// name — and whether this money came from one of them.
export function memberContactNote(m: RecordMember | null | undefined): RecordCheckNote | null {
  if (!m || !m.name) return null;
  const parts: string[] = [];
  if (m.phone) parts.push(`📞 ${m.phone}`);
  const accounts = m.accounts ?? [];
  parts.push(
    accounts.length
      ? `🏦 บัญชีที่ผูกไว้: ${accounts
          .map((a) => (a.paidFrom ? `${a.accountNumber} (บัญชีที่โอนมานี้)` : a.accountNumber))
          .join(", ")}`
      : "🏦 ยังไม่ได้ผูกเลขบัญชี"
  );
  return { tone: "info", text: parts.join(" · ") };
}

export function recordCheckNotes(c: RecordCheck): RecordCheckNote[] {
  const notes: RecordCheckNote[] = [];
  const who = memberNote(c.member);
  if (who) notes.push(who);
  const contact = memberContactNote(c.member);
  if (contact) notes.push(contact);
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
