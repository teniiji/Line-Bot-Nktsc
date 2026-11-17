// Linking many LINE accounts to members at once, from the สมาชิก LINE tab:
// every suggestion on the list (a typed name that matches one member), or the
// LINE_UserID column of the cooperative's สมาชิก_LINE_OA sheet.
//
// A link is what lets the bot know a member without asking (see
// lib/lineUserIdentity.ts): the member number goes on the LINE account and
// the register row is bound to it, exactly as when staff set one number by
// hand. The same refusals apply, because a wrong link files one member's
// money under another's name.
//
// The sheet's ids need one more guard. A LINE user id belongs to the OA that
// issued it, and the cooperative has moved OA before: every id then went
// stale at once, and stale bindings made the impersonation guard refuse
// members' own transactions (scripts/clear-line-links.ts). So an id is only
// used when someone with exactly that id has messaged this bot — which proves
// it is an id of the current OA. Anyone else is reported, not linked.

import { memberNumberKey } from "./memberNumber";
import { memberNumberProblem } from "./memberIdentity";

export interface LinkCandidate {
  lineUserId: string;
  memberNumber: string;
}

export interface LinkState {
  // LINE accounts that have messaged the bot, by id.
  lineUsers: Map<string, { memberNumber: string | null; label: string }>;
  // Register rows, by member number.
  roster: Map<string, { memberName: string; lineUserId: string | null }>;
  // Which LINE accounts already carry each member number.
  numberHolders: Map<string, string[]>;
}

export type LinkAction = "link" | "already" | "skip";

export interface LinkOutcome {
  lineUserId: string;
  memberNumber: string;
  action: LinkAction;
  // Who it is, for the list staff read before confirming.
  label: string;
  memberName: string | null;
  reason: string | null;
}

export const SKIP_REASONS = {
  notMessaged: "ยังไม่เคยทักบอท หรือเป็น ID ของ LINE OA เดิม",
  notInRoster: "เลขสมาชิกนี้ไม่อยู่ในทะเบียนสมาชิก",
  otherNumber: "บัญชี LINE นี้ผูกกับเลขสมาชิกอื่นอยู่แล้ว",
  boundElsewhere: "เลขสมาชิกนี้ผูกกับบัญชี LINE อื่นอยู่แล้ว",
  heldElsewhere: "มีบัญชี LINE อื่นใช้เลขสมาชิกนี้อยู่",
  duplicate: "ซ้ำในรายการ (LINE เดียวกันหลายเลข หรือเลขเดียวกันหลาย LINE)",
} as const;

export function planLinks(candidates: LinkCandidate[], state: LinkState): LinkOutcome[] {
  const cleaned = candidates
    .map((c) => ({ lineUserId: c.lineUserId.trim(), memberNumber: memberNumberKey(c.memberNumber) ?? "" }))
    .filter((c) => c.lineUserId && c.memberNumber);

  // The same pair twice is one row; a LINE account with two numbers, or a
  // number on two accounts, is a contradiction and none of it is used.
  const unique = new Map(cleaned.map((c) => [`${c.lineUserId}|${c.memberNumber}`, c]));
  const numbersOf = new Map<string, Set<string>>();
  const accountsOf = new Map<string, Set<string>>();
  for (const c of unique.values()) {
    numbersOf.set(c.lineUserId, (numbersOf.get(c.lineUserId) ?? new Set()).add(c.memberNumber));
    accountsOf.set(c.memberNumber, (accountsOf.get(c.memberNumber) ?? new Set()).add(c.lineUserId));
  }

  return [...unique.values()].map((c) => {
    const user = state.lineUsers.get(c.lineUserId);
    const row = state.roster.get(c.memberNumber);
    const outcome = (action: LinkAction, reason: string | null = null): LinkOutcome => ({
      ...c,
      action,
      label: user?.label ?? c.lineUserId,
      memberName: row?.memberName ?? null,
      reason,
    });

    if (!user) return outcome("skip", SKIP_REASONS.notMessaged);
    if (numbersOf.get(c.lineUserId)!.size > 1 || accountsOf.get(c.memberNumber)!.size > 1) {
      return outcome("skip", SKIP_REASONS.duplicate);
    }
    const problem = memberNumberProblem(c.memberNumber);
    if (problem) return outcome("skip", problem);
    if (!row) return outcome("skip", SKIP_REASONS.notInRoster);
    if (user.memberNumber && user.memberNumber !== c.memberNumber) {
      return outcome("skip", SKIP_REASONS.otherNumber);
    }
    if (row.lineUserId && row.lineUserId !== c.lineUserId) return outcome("skip", SKIP_REASONS.boundElsewhere);
    if ((state.numberHolders.get(c.memberNumber) ?? []).some((id) => id !== c.lineUserId)) {
      return outcome("skip", SKIP_REASONS.heldElsewhere);
    }
    if (user.memberNumber === c.memberNumber && row.lineUserId === c.lineUserId) return outcome("already");
    return outcome("link");
  });
}

// ---- The สมาชิก_LINE_OA sheet ---------------------------------------------
// Columns found by heading, never by position (the sheet is kept by hand).
const MEMBER_HEADINGS = ["เลขสมาชิก", "เลขที่สมาชิก", "รหัสสมาชิก", "memberno", "membernumber"];
const LINE_ID_HEADINGS = ["line_userid", "lineuserid", "userid", "lineid"];
const LINE_USER_ID = /^U[0-9a-f]{32}$/;

const headingKey = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();

export class LineSheetError extends Error {}

// Reads the pairs from whichever page of the workbook has both headings.
export function parseLineIdSheet(pages: unknown[][][]): { pairs: LinkCandidate[]; badIds: number } {
  for (const rows of pages) {
    for (let h = 0; h < Math.min(rows.length, 10); h++) {
      const header = rows[h].map(headingKey);
      const memberCol = header.findIndex((v) => MEMBER_HEADINGS.some((k) => v.includes(k)));
      const lineCol = header.findIndex((v) => LINE_ID_HEADINGS.some((k) => v.includes(k)));
      if (memberCol < 0 || lineCol < 0) continue;

      const pairs: LinkCandidate[] = [];
      let badIds = 0;
      for (const row of rows.slice(h + 1)) {
        const memberNumber = String(row[memberCol] ?? "").trim();
        const lineUserId = String(row[lineCol] ?? "").trim();
        if (!memberNumber || !lineUserId) continue;
        if (!LINE_USER_ID.test(lineUserId)) {
          badIds++;
          continue;
        }
        pairs.push({ lineUserId, memberNumber });
      }
      return { pairs, badIds };
    }
  }
  throw new LineSheetError(
    'ไม่พบหัวคอลัมน์ "เลขสมาชิก" และ "LINE_UserID" ในไฟล์ — ใช้ไฟล์ที่มีชีต สมาชิก_LINE_OA'
  );
}
