// Conversation state for the finance agent: what the bot already knows
// about this LINE user, whatever in-progress flow (transaction / service
// request / member-number lookup) is pending, and — via the
// computeXXXRequirement functions — which single piece of information the
// bot should ask for next. Split out of lib/financeAgent.ts.
import { prisma } from "../prisma";
import { namesLikelyMatch } from "../nameMatch";
import { CATEGORIES } from "../categories";
import { LOAN_TYPES } from "../loanTypes";
import {
  isFeatureEnabled,
  ASK_MEMBER_INFO_ENABLED,
  ASK_CATEGORY_ENABLED,
  ASK_LOAN_TYPE_ENABLED,
  ASK_DEPOSIT_ACCOUNT_ENABLED,
  ASK_CONFIRM_SENDER_NAME_ENABLED,
} from "../featureFlags";
import type {
  LineUserInfo,
  PendingInfo,
  Requirement,
  PendingServiceInfo,
  ServiceRequirement,
  PendingLookupInfo,
  LookupRequirement,
} from "./types";

// The subset of Requirement that's an actual staff-toggleable question —
// "slip" is the entry point (no slip, no transaction at all) and null means
// nothing's left to ask, so neither can be individually disabled.
export type QuestionRequirement =
  | "member_info"
  | "category"
  | "loan_type"
  | "deposit_account"
  | "confirm_sender_name";

const REQUIREMENT_FLAG_KEYS: Record<QuestionRequirement, string> = {
  member_info: ASK_MEMBER_INFO_ENABLED,
  category: ASK_CATEGORY_ENABLED,
  loan_type: ASK_LOAN_TYPE_ENABLED,
  deposit_account: ASK_DEPOSIT_ACCOUNT_ENABLED,
  confirm_sender_name: ASK_CONFIRM_SENDER_NAME_ENABLED,
};

// Reads the 5 ask_*_enabled switches (dashboard > ตั้งค่าระบบ) and returns
// which questions staff have turned off — pass the result into
// computeNextRequirement so a disabled question is skipped (transaction
// finalizes without that field) instead of blocking forever.
export async function loadDisabledRequirements(): Promise<Set<QuestionRequirement>> {
  const entries = Object.entries(REQUIREMENT_FLAG_KEYS) as [QuestionRequirement, string][];
  const enabledFlags = await Promise.all(entries.map(([, key]) => isFeatureEnabled(key)));
  const disabled = new Set<QuestionRequirement>();
  entries.forEach(([req], i) => {
    if (!enabledFlags[i]) disabled.add(req);
  });
  return disabled;
}

export function computeNextRequirement(
  lineUser: LineUserInfo | null,
  pending: PendingInfo,
  disabled: ReadonlySet<QuestionRequirement> = new Set()
): Requirement {
  if (!disabled.has("member_info") && (!lineUser?.fullName || !lineUser?.memberNumber)) {
    return "member_info";
  }
  if (!pending.hasSlip) return "slip";
  if (!disabled.has("category") && !pending.category) return "category";
  if (!disabled.has("loan_type") && pending.category === "ชำระหนี้" && !pending.loanType) {
    return "loan_type";
  }
  if (
    !disabled.has("deposit_account") &&
    pending.category === "ฝากเงิน" &&
    !pending.depositAccountNumber
  ) {
    return "deposit_account";
  }
  // Comparison happens here rather than at submit time, since a slip can
  // arrive before member identity is known (see the "member_info" flowNote
  // branch below) — this re-evaluates fresh every turn once both are
  // available, whichever order they were supplied in. Guarded on
  // lineUser?.fullName since member_info may have been skipped above while
  // still disabled, leaving fullName null.
  if (
    !disabled.has("confirm_sender_name") &&
    lineUser?.fullName &&
    pending.slipSenderName &&
    !pending.senderNameConfirmed &&
    !namesLikelyMatch(lineUser.fullName, pending.slipSenderName)
  ) {
    return "confirm_sender_name";
  }
  return null;
}


// Thai label for a Requirement, shown to staff in the "รายการค้าง" dashboard
// panel (components/PendingTransactionsPanel.tsx) so they can see at a
// glance what each unfinished PendingTransaction row is waiting on, without
// needing to read the bot's own conversational phrasing.
export function describeRequirement(req: Requirement): string {
  switch (req) {
    case "member_info":
      return "รอชื่อ-นามสกุลและเลขสมาชิก";
    case "slip":
      return "รอรูปสลิปการโอนเงิน";
    case "category":
      return "รอหมวดหมู่ธุรกรรม";
    case "loan_type":
      return "รอประเภทเงินกู้";
    case "deposit_account":
      return "รอเลขที่บัญชีที่จะฝาก";
    case "confirm_sender_name":
      return "รอยืนยันว่าชื่อในสลิปเป็นของสมาชิกเอง";
    case null:
      return "ครบถ้วนแล้ว รอบันทึก";
  }
}


// After a reply is produced, re-derive what the bot is now waiting on and
// offer tappable buttons for the pick-one steps (category, loan type) so
// the member selects instead of typing a free-form answer the model then
// has to interpret. Other steps (member info, slip, purpose) are free-form
// or image-based, so no buttons.
export async function computeQuickReplies(lineUserId: string): Promise<string[]> {
  const [lineUser, pending] = await Promise.all([
    loadLineUser(lineUserId),
    loadPending(lineUserId),
  ]);
  if (!pending) return [];
  const next = computeNextRequirement(lineUser, pending);
  if (next === "category") return [...CATEGORIES];
  if (next === "loan_type") return [...LOAN_TYPES];
  return [];
}


export const PENDING_TRANSACTION_EXPIRY_MS = 30 * 60 * 1000;


export async function loadLineUser(lineUserId: string): Promise<LineUserInfo | null> {
  // Prefer the imported roster keyed by this LINE account's own userId —
  // that's LINE's account identity, so it can't be spoofed by typing
  // someone else's name/number. Covers members whose LINE is already
  // linked in the roster; they never get asked for their info at all.
  // phone always comes from LineUser regardless — MemberRoster has no
  // phone column, and it's this bot's own self-reported field either way.
  const [roster, user] = await Promise.all([
    prisma.memberRoster.findFirst({
      where: { lineUserId },
      select: { memberName: true, memberNumber: true },
    }),
    prisma.lineUser.findUnique({
      where: { id: lineUserId },
      select: { fullName: true, memberNumber: true, phone: true },
    }),
  ]);
  if (roster) {
    return {
      fullName: roster.memberName,
      memberNumber: roster.memberNumber,
      verified: true,
      phone: user?.phone ?? null,
    };
  }

  if (!user) return null;
  return {
    fullName: user.fullName,
    memberNumber: user.memberNumber,
    verified: false,
    phone: user.phone,
  };
}


export async function loadPending(lineUserId: string): Promise<PendingInfo | null> {
  const pending = await prisma.pendingTransaction.findUnique({
    where: { lineUserId },
  });
  if (!pending) return null;
  if (Date.now() - pending.createdAt.getTime() > PENDING_TRANSACTION_EXPIRY_MS) {
    await prisma.pendingTransaction.delete({ where: { lineUserId } }).catch(() => {});
    return null;
  }
  return pending;
}


// Purpose is asked before member info, matching the natural conversational
// order: the user has already shown a document, so "what's this for" comes
// first; member identity only matters once we know what to attach it to.
// Phone is asked last — it's only needed for staff to call the member back
// about this specific request, so there's no point asking before we even
// know who they are or what they want.
export function computeServiceRequirement(
  lineUser: LineUserInfo | null,
  pendingService: PendingServiceInfo
): ServiceRequirement {
  if (!pendingService.requestType) return "purpose";
  if (!lineUser?.fullName || !lineUser?.memberNumber) return "member_info";
  if (!lineUser?.phone) return "phone";
  return null;
}


export async function loadPendingServiceRequest(
  lineUserId: string
): Promise<PendingServiceInfo | null> {
  const pending = await prisma.pendingServiceRequest.findUnique({
    where: { lineUserId },
  });
  if (!pending) return null;
  if (Date.now() - pending.createdAt.getTime() > PENDING_TRANSACTION_EXPIRY_MS) {
    await prisma.pendingServiceRequest.delete({ where: { lineUserId } }).catch(() => {});
    return null;
  }
  return pending;
}


export function computeLookupRequirement(pending: PendingLookupInfo): LookupRequirement {
  if (!pending.fullName) return "full_name";
  if (!pending.nationalId) return "national_id";
  if (!pending.phone) return "phone";
  return null;
}

// Unlike computeLookupRequirement (single next field, for forcing a tool
// call), this returns every still-missing field so the caller can ask for
// all of them together in one message instead of one at a time across
// several round trips — this is the member-number lookup flow's own
// deliberate one-question-per-turn pacing, which a member asked to have
// collapsed into a single ask.
export function computeLookupMissingFields(pending: PendingLookupInfo): LookupRequirement[] {
  const missing: Exclude<LookupRequirement, null>[] = [];
  if (!pending.fullName) missing.push("full_name");
  if (!pending.nationalId) missing.push("national_id");
  if (!pending.phone) missing.push("phone");
  return missing;
}


export async function loadPendingLookup(lineUserId: string): Promise<PendingLookupInfo | null> {
  const pending = await prisma.pendingMemberLookup.findUnique({
    where: { lineUserId },
  });
  if (!pending) return null;
  if (Date.now() - pending.createdAt.getTime() > PENDING_TRANSACTION_EXPIRY_MS) {
    await prisma.pendingMemberLookup.delete({ where: { lineUserId } }).catch(() => {});
    return null;
  }
  return pending;
}

