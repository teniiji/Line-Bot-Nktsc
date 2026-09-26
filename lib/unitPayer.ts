// A unit's payroll office paying for several members in one transfer
// ("Kalasin PESA 2/สนง.เขตพื้นที่การศึกษาฯ" ฿29,200). The bank line names no
// member and no member's account, so the money reads as nobody's until staff
// say how it divides. Staff name the payer once; the next line from it is
// recognised by its description, and the members it paid for last time come
// back as the starting point for the next split.
//
// Pure rules only; lib/lineSplitStore.ts reads and writes the rows.

import { memberNumberKey } from "./memberNumber";

const EPSILON = 0.01;
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Which payer a statement description is from, as a key that stays the same
 * month to month: the description's own segments with the ones that are only
 * digits (a reference that changes per transfer) left out, spacing and case
 * evened out. Null for a description with nothing to go on.
 *
 *   "KHON KAEN CM TA/เทศบาลนครขอนแก่น/200405" → "khon kaen cm ta/เทศบาลนครขอนแก่น"
 */
export function payerKey(description: string | null | undefined): string | null {
  const segments = String(description ?? "")
    .split("/")
    .map((s) => s.replace(/\s+/g, " ").trim().toLowerCase())
    .filter((s) => s !== "" && !/^[\d\s.,-]+$/.test(s));
  return segments.length ? segments.join("/") : null;
}

/** What the statement itself calls the payer, offered as the name to keep. */
export function suggestedPayerName(description: string | null | undefined): string {
  const segments = String(description ?? "")
    .split("/")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s !== "" && !/^[\d\s.,-]+$/.test(s));
  return segments.join(" / ");
}

export interface SplitPart {
  memberNumber: string;
  amount: number;
}

/**
 * Why a split of a line cannot be saved, or null when it can: every part a
 * member and a positive amount, nobody twice, and the parts adding up to
 * exactly the line — a split that leaves money over or takes more than
 * arrived is counting somebody's money that is not there.
 */
export function splitProblem(total: number, parts: SplitPart[]): string | null {
  if (parts.length === 0) return "ยังไม่ได้ใส่สมาชิก";
  const seen = new Set<string>();
  for (const part of parts) {
    const key = memberNumberKey(part.memberNumber);
    if (!key) return "มีแถวที่ยังไม่ได้ใส่เลขสมาชิก";
    if (seen.has(key)) return `เลขสมาชิก ${part.memberNumber} ซ้ำ`;
    seen.add(key);
    if (!Number.isFinite(part.amount) || part.amount <= 0) {
      return `ยอดของ ${part.memberNumber} ต้องมากกว่า 0`;
    }
  }
  const sum = round2(parts.reduce((s, p) => s + p.amount, 0));
  if (Math.abs(sum - total) >= EPSILON) {
    const diff = round2(total - sum);
    return diff > 0
      ? `ยอดรวมยังขาดอีก ${diff.toFixed(2)} บาท (รวม ${sum.toFixed(2)} จาก ${total.toFixed(2)})`
      : `ยอดรวมเกินมา ${(-diff).toFixed(2)} บาท (รวม ${sum.toFixed(2)} จาก ${total.toFixed(2)})`;
  }
  return null;
}

/** The part of a round row's fingerprint that says which member of a split it is. */
export const splitFingerprint = (lineFingerprint: string, memberNumber: string) =>
  `line:${lineFingerprint}#${memberNumberKey(memberNumber) ?? memberNumber}`;

// Where a round row that is only a share of a bank line came from, read off
// its fingerprint:
//   - "line"  — divided on the daily page (splitFingerprint above); the key is
//     the bank line's own fingerprint.
//   - "round" — split off another row of the round by "แบ่งให้สมาชิกอื่น"
//     ("<parent>::split:<uuid>"); the key is that row's fingerprint.
// null for every row that is a whole line of its own.
export type SplitSource = { kind: "line"; lineFingerprint: string } | { kind: "round"; parentFingerprint: string };

export function splitSourceOf(fingerprint: string): SplitSource | null {
  const piece = fingerprint.indexOf("::split:");
  if (piece > 0) return { kind: "round", parentFingerprint: fingerprint.slice(0, piece) };
  const line = /^line:(.+)#[^#]+$/.exec(fingerprint);
  if (line) return { kind: "line", lineFingerprint: line[1] };
  return null;
}

// Whether a line reads like a unit's payroll office paying — the only kind
// recording it for a member may teach the system to recognise again. Those
// name the office between slashes ("Education Coun/สำนักงานเลขาธิการสภา
// การศึกษา", "KHON KAEN CM TA/เทศบาลนครขอนแก่น/200405"). A QR payment's
// description is the cooperative's own merchant code, the same on every one
// of them, and a cheque's is whoever wrote it: remembering either would hand
// every later QR payment, or every later cheque, to one member.
export function isUnitPayerLine(description: string | null | undefined): boolean {
  if (!description || !description.includes("/")) return false;
  return description
    .split("/")
    .map((part) => part.trim())
    .some((part) => part.length >= 3 && !/^[\d\s-]+$/.test(part) && /[A-Za-z฀-๿]/.test(part));
}
