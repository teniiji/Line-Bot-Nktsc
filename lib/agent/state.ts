// Conversation state for the finance agent: what the bot already knows
// about this LINE user, whatever in-progress flow (transaction / service
// request / member-number lookup) is pending, and — via the
// computeXXXRequirement functions — which single piece of information the
// bot should ask for next. Split out of lib/financeAgent.ts.
import { prisma } from "../prisma";
import { namesLikelyMatch } from "../nameMatch";
import { CATEGORIES } from "../categories";
import { LOAN_TYPES } from "../loanTypes";
import type {
  LineUserInfo,
  PendingInfo,
  Requirement,
  PendingServiceInfo,
  ServiceRequirement,
  PendingLookupInfo,
  LookupRequirement,
} from "./types";

export function computeNextRequirement(
  lineUser: LineUserInfo | null,
  pending: PendingInfo
): Requirement {
  if (!lineUser?.fullName || !lineUser?.memberNumber) return "member_info";
  if (!pending.hasSlip) return "slip";
  if (!pending.category) return "category";
  if (pending.category === "ชำระหนี้" && !pending.loanType) return "loan_type";
  if (pending.category === "ฝากเงิน" && !pending.depositAccountNumber) return "deposit_account";
  // Comparison happens here rather than at submit time, since a slip can
  // arrive before member identity is known (see the "member_info" flowNote
  // branch below) — this re-evaluates fresh every turn once both are
  // available, whichever order they were supplied in.
  if (
    pending.slipSenderName &&
    !pending.senderNameConfirmed &&
    !namesLikelyMatch(lineUser.fullName, pending.slipSenderName)
  ) {
    return "confirm_sender_name";
  }
  return null;
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

