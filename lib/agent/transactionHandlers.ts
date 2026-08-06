// Tool handlers for recording a member's transaction: reading a slip into a
// PendingTransaction, collecting whatever the slip didn't tell us (loan type,
// deposit account, sender-name confirmation), and committing the finished
// result to Expense. Split out of ./handlers.ts, which now only dispatches.
//
// submit_member_info lives in ./identityHandlers.ts instead — it feeds this
// flow but also the service-request one, so it belongs to neither.
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { CATEGORIES } from "../categories";
import { LOAN_TYPES } from "../loanTypes";
import { formatAmount } from "../format";
import { isPlaceholderText } from "../placeholderText";
import { namesLikelyMatch } from "../nameMatch";
import { classifyRecipient } from "../recipientCheck";
import { isFeatureEnabled, TRANSACTIONS_ENABLED } from "../featureFlags";
import {
  loadLineUser,
  loadPending,
  computeNextRequirement,
  loadDisabledRequirements,
} from "./state";
import { notifyTransactionForward } from "./forwarding";
import type { LineUserInfo, PendingInfo, Requirement, ToolContext } from "./types";
// Creates the Expense row from a now-complete pending transaction plus the
// member's saved identity, then clears the pending record. Shared by every
// tool handler that might supply the last missing piece of information.
export async function finalizeTransaction(
  lineUserId: string,
  pending: PendingInfo,
  lineUser: LineUserInfo
): Promise<string> {
  if (
    typeof pending.amount !== "number" ||
    !Number.isFinite(pending.amount) ||
    pending.amount <= 0
  ) {
    return "Error: amount is missing or invalid — ask the user for the transaction amount.";
  }
  if (!pending.category) {
    return "Error: category is missing — ask the user what this transaction was for.";
  }

  // Recomputed here rather than trusted from whatever state got it past
  // computeNextRequirement — that only checks "confirmed", not "matches",
  // so this is what actually drives senderNameMismatch on the permanent
  // record (true whenever a name was read and it didn't match, regardless
  // of the confirm step's outcome).
  const senderNameMismatch = pending.slipSenderName
    ? !namesLikelyMatch(lineUser.fullName ?? "", pending.slipSenderName)
    : false;

  try {
    const expense = await prisma.expense.create({
      data: {
        amount: pending.amount,
        category: pending.category,
        description: pending.description,
        date: pending.date ?? new Date(),
        lineUserId,
        referenceNumber: pending.referenceNumber,
        slipImageHash: pending.slipImageHash,
        slipImageUrl: pending.slipImageUrl,
        slipIsPdf: pending.slipIsPdf,
        memberFullName: lineUser.fullName,
        memberNumber: lineUser.memberNumber,
        memberVerified: lineUser.verified,
        loanType: pending.loanType,
        depositAccountNumber: pending.depositAccountNumber,
        slipSenderName: pending.slipSenderName,
        senderNameMismatch,
      },
    });
    await prisma.pendingTransaction.delete({ where: { lineUserId } }).catch(() => {});
    await notifyTransactionForward(lineUserId, expense, lineUser);

    return `Logged: ${formatAmount(expense.amount)} (${expense.category}) on ${expense.date
      .toISOString()
      .slice(0, 10)} for member ${lineUser.fullName} (${lineUser.memberNumber}).`;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      ((err.meta?.target as string[] | undefined)?.includes("referenceNumber") ||
        (err.meta?.target as string[] | undefined)?.includes("slipImageHash"))
    ) {
      await prisma.pendingTransaction.delete({ where: { lineUserId } }).catch(() => {});
      return "Error: this exact transaction (same slip image or same reference number) was already recorded — this looks like a duplicate slip. Tell the user it was already logged and do not log it again.";
    }
    throw err;
  }
}


export function requirementMessage(next: Requirement): string {
  if (next === "member_info") {
    return "Still missing: member full name and member number. Ask the user for their ชื่อ-นามสกุล and เลขสมาชิก next, in Thai. Do not log yet.";
  }
  if (next === "slip") {
    return "Still missing: a photo of the transfer slip. Ask the user to send it next, in Thai. Do not log yet.";
  }
  if (next === "category") {
    return `Still missing: which category this transaction is for — the slip showed no stated purpose. Ask the user directly, in Thai, listing the options: ${CATEGORIES.join(
      ", "
    )}. Do not guess. Do not log yet.`;
  }
  if (next === "loan_type") {
    return `Still missing: loan type for this ชำระหนี้ repayment. Ask the user to specify one of: ${LOAN_TYPES.join(
      ", "
    )}. Do not log yet.`;
  }
  if (next === "deposit_account") {
    return "Still missing: which cooperative account number this ฝากเงิน deposit is going into. Ask the user for it next, in Thai. Do not log yet.";
  }
  if (next === "confirm_sender_name") {
    return "Still missing: confirmation that this is genuinely the member's own transaction — the slip's sender name didn't match their registered name. Ask them to confirm next, in Thai. Do not log yet.";
  }
  return "";
}


export type ReportTransactionInput = {
  category?: unknown;
  amount?: unknown;
  description?: unknown;
  date?: unknown;
  referenceNumber?: unknown;
  senderName?: unknown;
  recipientName?: unknown;
};


export async function reportTransaction(
  input: ReportTransactionInput,
  ctx: ToolContext
): Promise<string> {
  // Staff-toggleable (dashboard > ตั้งค่าระบบ) — checked before touching any
  // pending state so a slip sent while paused never gets half-recorded.
  if (!(await isFeatureEnabled(TRANSACTIONS_ENABLED))) {
    return "Error: transaction logging is temporarily paused by staff. Apologize to the user, in Thai, and tell them to try again later or contact the cooperative office directly — do not log anything.";
  }

  const { category, amount, description, date, referenceNumber, senderName, recipientName } =
    input;

  // Deterministic backstop for the prompt's "must be a transfer to the
  // cooperative" rule (ขั้นที่ 1.5), which the model has ignored in
  // production — it logged a slip paying a private individual and told the
  // member the money went to the cooperative. Runs before anything is
  // stored so a rejected slip leaves no pending state behind. Only a
  // recipient that clearly carries a personal-name title is rejected here;
  // shops/ambiguous names stay subject to the model's own judgment.
  if (
    typeof recipientName === "string" &&
    recipientName.trim() &&
    !isPlaceholderText(recipientName) &&
    classifyRecipient(recipientName) === "person"
  ) {
    return `Error: the slip's recipient ("${recipientName.trim()}") is a private individual, not สหกรณ์ออมทรัพย์ครูหนองคาย จำกัด. This transaction must NOT be logged. Tell the user, in Thai, that this slip is not a transfer to the cooperative's account so it cannot be recorded, and to send the slip of their transfer to the cooperative instead.`;
  }

  // category is optional — a slip with no stated purpose legitimately has
  // none yet, and the system will ask the user for it (computeNextRequirement
  // returns "category"). Only reject a category that was actually supplied
  // but isn't one of the fixed options.
  if (
    category !== undefined &&
    (typeof category !== "string" ||
      !CATEGORIES.includes(category as (typeof CATEGORIES)[number]))
  ) {
    return `Error: category must be one of ${CATEGORIES.join(", ")}.`;
  }
  const parsedCategory = typeof category === "string" ? category : null;

  const parsedAmount =
    typeof amount === "number" && Number.isFinite(amount) && amount > 0 ? amount : null;
  const parsedDate = typeof date === "string" && date ? new Date(date) : new Date();
  if (Number.isNaN(parsedDate.getTime())) {
    return "Error: invalid date.";
  }
  const refNumber =
    typeof referenceNumber === "string" && referenceNumber ? referenceNumber : null;
  const parsedDescription =
    typeof description === "string" && description ? description : null;
  // Same placeholder guard as submit_member_info/submit_contact_phone/
  // submit_deposit_account — this field is optional, so a placeholder here
  // just gets dropped (treated as "not read") rather than erroring out and
  // blocking the whole report_transaction call over an optional field.
  const parsedSenderName =
    typeof senderName === "string" && senderName.trim() && !isPlaceholderText(senderName)
      ? senderName.trim()
      : null;

  // Catch a duplicate slip as early as possible instead of only at the
  // final commit, which may be several messages away once member info and
  // loan type are also collected. Check the image hash first — it's exact
  // and doesn't depend on the model reading the same reference number
  // twice, which isn't guaranteed across two separate OCR passes.
  if (ctx.slipImageHash) {
    const existingByHash = await prisma.expense.findUnique({
      where: { slipImageHash: ctx.slipImageHash },
    });
    if (existingByHash) {
      return "Error: this exact slip image was already recorded previously — this is a duplicate. Tell the user it was already logged and do not log or hold it again.";
    }
  }
  if (refNumber) {
    const existing = await prisma.expense.findUnique({ where: { referenceNumber: refNumber } });
    if (existing) {
      return "Error: a transaction with this exact reference number was already recorded — this looks like a duplicate slip. Tell the user it was already logged and do not log or hold it again.";
    }
  }

  // If an amount was already on record for this pending transaction (e.g.
  // stated in an earlier text message) and this call reports a different
  // one (typically the amount actually read off a slip), don't silently
  // pick one — the newer value wins (the slip is verifiable evidence) but
  // the discrepancy is surfaced to the user rather than logged unnoticed.
  const existingPending = await prisma.pendingTransaction.findUnique({
    where: { lineUserId: ctx.lineUserId },
  });
  const amountMismatch =
    existingPending?.amount != null &&
    parsedAmount !== null &&
    Math.abs(existingPending.amount - parsedAmount) > 0.005;
  const mismatchNote = amountMismatch
    ? ` Note: the amount previously on record (${formatAmount(
        existingPending!.amount!
      )}) doesn't match the amount just reported (${formatAmount(
        parsedAmount!
      )}) — the new amount is now used. Point out this discrepancy to the user in your reply so they can correct it if it's wrong.`
    : "";

  const slipImageUrl = ctx.slipImageUrl;

  const pending = await prisma.pendingTransaction.upsert({
    where: { lineUserId: ctx.lineUserId },
    create: {
      lineUserId: ctx.lineUserId,
      category: parsedCategory,
      amount: parsedAmount,
      description: parsedDescription,
      date: parsedDate,
      hasSlip: ctx.hasSlipImage,
      slipImageHash: ctx.slipImageHash,
      slipImageUrl,
      slipIsPdf: ctx.slipIsPdf,
      referenceNumber: refNumber,
      slipSenderName: parsedSenderName,
    },
    update: {
      // Only overwrite fields we actually have new info for, so a slip
      // arriving after the amount was already known from text (or vice
      // versa) doesn't clobber it with null.
      ...(parsedCategory !== null ? { category: parsedCategory } : {}),
      ...(parsedAmount !== null ? { amount: parsedAmount } : {}),
      ...(parsedDescription !== null ? { description: parsedDescription } : {}),
      date: parsedDate,
      // Only ever set to true, never back to false, once a slip has been
      // seen for this pending transaction.
      ...(ctx.hasSlipImage ? { hasSlip: true, slipIsPdf: ctx.slipIsPdf } : {}),
      ...(ctx.slipImageHash ? { slipImageHash: ctx.slipImageHash } : {}),
      ...(slipImageUrl ? { slipImageUrl } : {}),
      ...(refNumber ? { referenceNumber: refNumber } : {}),
      // A new slip's sender name replaces any earlier one and resets
      // confirmation — a different slip image needs its own check.
      ...(parsedSenderName
        ? { slipSenderName: parsedSenderName, senderNameConfirmed: false }
        : {}),
      createdAt: new Date(),
    },
  });

  const [lineUser, disabled] = await Promise.all([
    loadLineUser(ctx.lineUserId),
    loadDisabledRequirements(),
  ]);
  const next = computeNextRequirement(lineUser, pending, disabled);
  if (next === null) {
    const result = await finalizeTransaction(ctx.lineUserId, pending, lineUser as LineUserInfo);
    return result + mismatchNote;
  }
  return requirementMessage(next) + mismatchNote;
}



export type SubmitLoanTypeInput = {
  loanType?: unknown;
};


export async function submitLoanType(
  input: SubmitLoanTypeInput,
  ctx: ToolContext
): Promise<string> {
  const loanType =
    typeof input.loanType === "string" &&
    LOAN_TYPES.includes(input.loanType as (typeof LOAN_TYPES)[number])
      ? input.loanType
      : null;
  if (!loanType) {
    return `Error: loanType must be one of ${LOAN_TYPES.join(", ")}.`;
  }

  const pending = await loadPending(ctx.lineUserId);
  if (!pending || pending.category !== "ชำระหนี้") {
    return "Error: no in-progress ชำระหนี้ transaction to attach a loan type to.";
  }

  const updated = await prisma.pendingTransaction.update({
    where: { lineUserId: ctx.lineUserId },
    data: { loanType, createdAt: new Date() },
  });

  const [lineUser, disabled] = await Promise.all([
    loadLineUser(ctx.lineUserId),
    loadDisabledRequirements(),
  ]);
  const next = computeNextRequirement(lineUser, updated, disabled);
  if (next === null) {
    return await finalizeTransaction(ctx.lineUserId, updated, lineUser as LineUserInfo);
  }
  return requirementMessage(next);
}


export type SubmitDepositAccountInput = {
  accountNumber?: unknown;
};


export async function submitDepositAccount(
  input: SubmitDepositAccountInput,
  ctx: ToolContext
): Promise<string> {
  const accountNumber =
    typeof input.accountNumber === "string" ? input.accountNumber.trim() : "";
  if (isPlaceholderText(accountNumber)) {
    return "Error: accountNumber must be the actual account number the user stated — never a placeholder like 'unknown' or '-'. If they haven't actually stated one yet, ask them again, in Thai, instead of calling this tool.";
  }

  const pending = await loadPending(ctx.lineUserId);
  if (!pending || pending.category !== "ฝากเงิน") {
    return "Error: no in-progress ฝากเงิน transaction to attach an account number to.";
  }

  const updated = await prisma.pendingTransaction.update({
    where: { lineUserId: ctx.lineUserId },
    data: { depositAccountNumber: accountNumber, createdAt: new Date() },
  });

  const [lineUser, disabled] = await Promise.all([
    loadLineUser(ctx.lineUserId),
    loadDisabledRequirements(),
  ]);
  const next = computeNextRequirement(lineUser, updated, disabled);
  if (next === null) {
    return await finalizeTransaction(ctx.lineUserId, updated, lineUser as LineUserInfo);
  }
  return requirementMessage(next);
}


export type ConfirmTransactionSenderInput = {
  confirmed?: unknown;
};


export async function confirmTransactionSender(
  input: ConfirmTransactionSenderInput,
  ctx: ToolContext
): Promise<string> {
  const pending = await loadPending(ctx.lineUserId);
  if (!pending || !pending.slipSenderName) {
    return "Error: no in-progress transaction awaiting sender-name confirmation.";
  }

  if (input.confirmed !== true) {
    // The user said this slip isn't genuinely theirs — don't log it, and
    // don't leave a stale pending transaction around for the next message
    // to accidentally attach to.
    await prisma.pendingTransaction.delete({ where: { lineUserId: ctx.lineUserId } }).catch(() => {});
    return "The user said this slip is not genuinely their own transaction. Do not log it. Apologize, in Thai, and ask them to double-check and send the correct slip, or contact the cooperative office if they believe this is a mistake.";
  }

  const updated = await prisma.pendingTransaction.update({
    where: { lineUserId: ctx.lineUserId },
    data: { senderNameConfirmed: true, createdAt: new Date() },
  });

  const [lineUser, disabled] = await Promise.all([
    loadLineUser(ctx.lineUserId),
    loadDisabledRequirements(),
  ]);
  const next = computeNextRequirement(lineUser, updated, disabled);
  if (next === null) {
    return await finalizeTransaction(ctx.lineUserId, updated, lineUser as LineUserInfo);
  }
  return requirementMessage(next);
}


export type SummaryInput = {
  from?: unknown;
  to?: unknown;
  category?: unknown;
};


export async function getTransactionSummary(
  input: SummaryInput,
  lineUserId: string
): Promise<string> {
  const { from, to, category } = input;

  const where: Record<string, unknown> = { lineUserId };

  if (typeof category === "string" && category) {
    if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
      return `Error: category must be one of ${CATEGORIES.join(", ")}.`;
    }
    where.category = category;
  }

  if (typeof from === "string" || typeof to === "string") {
    where.date = {
      ...(typeof from === "string" && from ? { gte: new Date(from) } : {}),
      // `to` is a date-only string (e.g. "2026-07-09"), which parses to
      // UTC midnight. Use an exclusive upper bound one day later so the
      // whole day is included instead of only timestamps at/before 00:00.
      ...(typeof to === "string" && to
        ? { lt: new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000) }
        : {}),
    };
  }

  const grouped = await prisma.expense.groupBy({
    by: ["category"],
    where,
    _sum: { amount: true },
    _count: true,
  });

  if (grouped.length === 0) {
    return "No matching transactions found for this user in the given range.";
  }

  const total = grouped.reduce((sum, g) => sum + (g._sum.amount ?? 0), 0);
  const breakdown = grouped
    .map(
      (g) =>
        `${g.category}: ${formatAmount(g._sum.amount ?? 0)} (${g._count} records)`
    )
    .join("; ");

  return `Total: ${formatAmount(total)}. Breakdown: ${breakdown}.`;
}
