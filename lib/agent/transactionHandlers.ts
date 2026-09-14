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
import { cooperativeNow } from "../cooperativeClock";
import { namesLikelyMatch } from "../nameMatch";
import { normalizeAccountPattern, parseSlipTime } from "../slipDetails";
import { classifyRecipient } from "../recipientCheck";
import { isFeatureEnabled, TRANSACTIONS_ENABLED } from "../featureFlags";
import { startsNewPayment } from "../pendingSlip";
import {
  isRepeatOfLogged,
  ALREADY_LOGGED_INSTRUCTION,
  REPEAT_WINDOW_MS,
} from "../repeatReport";
import {
  loadAllPending,
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
        date: pending.date ?? cooperativeNow(),
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
        // Carried onto the permanent record so the daily reconciliation has
        // them: the time tells apart several payments of the same amount, and
        // the account is the member's own statement of where the money came
        // from — independent of the bank-account directory, which is only as
        // complete as staff have made it.
        slipTransferTime: pending.slipTransferTime,
        slipSenderAccount: pending.slipSenderAccount,
      },
    });
    // By id: this member may have another slip still queued behind this one,
    // and deleting by lineUserId would throw it away unlogged.
    await prisma.pendingTransaction.delete({ where: { id: pending.id } }).catch(() => {});
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
      await prisma.pendingTransaction.delete({ where: { id: pending.id } }).catch(() => {});
      return "Error: this exact transaction (same slip image or same reference number) was already recorded — this looks like a duplicate slip. Tell the user it was already logged and do not log it again.";
    }
    throw err;
  }
}


// The tool the model is forced to call answers exactly one question. Anything
// else the member said in the same breath arrives here unsaved, and "ask the
// user for X next" — all this used to say — reads as permission to drop it.
//
// That is what turned one ฿30,000 repayment into seven minutes and ten
// messages: the member sent the slip and wrote "จ่ายหนี้นะคะ", and was asked
// for the category twice afterwards; then wrote "ดำรงชีพ ATM น.ส.กาญจภัษฐ์ วงษ์สวรรค์",
// had the name saved and the loan type dropped, and was asked for the loan
// type twice more. Both answers were in messages the bot had already read.
//
// Order is not decoration: submit_loan_type refuses a transaction whose
// category is not yet ชำระหนี้, so the category has to be banked first.
export const CAPTURE_BEFORE_ASKING =
  " IMPORTANT — before you ask for it, re-read the member's current message." +
  " If it ALSO states the transaction category, call report_transaction with that category now, in this same turn." +
  ` If it ALSO states the loan type (one of ${LOAN_TYPES.join(", ")}), call submit_loan_type` +
  " — after report_transaction if the category came in the same message, since a loan type cannot attach to a transaction that is not ชำระหนี้ yet." +
  " If it ALSO states the deposit account number, call submit_deposit_account." +
  " Ask only for what is still genuinely unknown once you have done that, and NEVER ask the member for something they have already told you.";

export function requirementMessage(next: Requirement): string {
  if (next === "member_info") {
    return (
      "Still missing: member full name and member number. Ask the user for their ชื่อ-นามสกุล and เลขสมาชิก next, in Thai. Do not log yet." +
      CAPTURE_BEFORE_ASKING
    );
  }
  if (next === "slip") {
    return (
      "Still missing: a photo of the transfer slip. Ask the user to send it next, in Thai. Do not log yet." +
      CAPTURE_BEFORE_ASKING
    );
  }
  if (next === "category") {
    return (
      `Still missing: which category this transaction is for — the slip showed no stated purpose. Ask the user directly, in Thai, listing the options: ${CATEGORIES.join(
        ", "
      )}. Do not guess. Do not log yet.` + CAPTURE_BEFORE_ASKING
    );
  }
  if (next === "loan_type") {
    return (
      `Still missing: loan type for this ชำระหนี้ repayment. Ask the user to specify one of: ${LOAN_TYPES.join(
        ", "
      )}. Do not log yet.` + CAPTURE_BEFORE_ASKING
    );
  }
  if (next === "deposit_account") {
    return (
      "Still missing: which cooperative account number this ฝากเงิน deposit is going into. Ask the user for it next, in Thai. Do not log yet." +
      CAPTURE_BEFORE_ASKING
    );
  }
  if (next === "confirm_sender_name") {
    return (
      "Still missing: confirmation that this is genuinely the member's own transaction — the slip's sender name didn't match their registered name. Ask them to confirm next, in Thai. Do not log yet." +
      CAPTURE_BEFORE_ASKING
    );
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
  transferTime?: unknown;
  senderAccount?: unknown;
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

  const {
    category,
    amount,
    description,
    date,
    referenceNumber,
    senderName,
    recipientName,
    transferTime,
    senderAccount,
  } = input;

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
  // The cooperative's own clock, not the server's. A slip filed at two in the
  // morning in Nong Khai belongs to that morning; stored as a real instant it
  // was filed against the previous day everywhere the system reads a day
  // boundary — see lib/cooperativeClock.ts. A date the model supplies is a
  // plain day already (no clock, no zone), so it needs no shifting.
  const parsedDate =
    typeof date === "string" && date ? new Date(date) : cooperativeNow();
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

  // Both are optional and both fail closed: a time that is not a real clock,
  // or an "account" that turns out to be a bank name, is dropped rather than
  // stored. A wrong value here would rank a reconciliation pairing
  // confidently in the wrong direction, which is worse than having none.
  const parsedTransferTime = parseSlipTime(transferTime);
  // Stored exactly as printed, mask characters and all — normalizeAccountPattern
  // is only asked whether it *could* be an account, so that changing how much
  // of one has to be visible later needs no slips re-read.
  const parsedSenderAccount =
    typeof senderAccount === "string" &&
    !isPlaceholderText(senderAccount) &&
    normalizeAccountPattern(senderAccount)
      ? senderAccount.trim()
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

  // The row the bot is currently asking about — the oldest still alive, since
  // a member may have more than one payment waiting.
  const queued = await loadAllPending(ctx.lineUserId);
  const active = queued[0] ?? null;

  // Nothing is waiting, so this call would open a brand-new row. That is the
  // right thing for a new payment and the wrong thing for the message right
  // after a confirmation, which is how a finished transaction was being
  // re-opened as a slipless phantom — see lib/repeatReport.ts.
  if (!active) {
    const recent = await prisma.expense.findFirst({
      where: {
        lineUserId: ctx.lineUserId,
        createdAt: { gte: new Date(Date.now() - REPEAT_WINDOW_MS) },
      },
      orderBy: { createdAt: "desc" },
      select: { amount: true, category: true, createdAt: true },
    });
    const repeat = isRepeatOfLogged(
      { amount: parsedAmount, category: parsedCategory, hasSlip: ctx.hasSlipImage },
      recent,
      new Date()
    );
    if (repeat) return ALREADY_LOGGED_INSTRUCTION;
  }

  // A different slip arriving while one is still unanswered is a second
  // payment, not a correction to the first. It used to overwrite it, and the
  // first payment vanished with no trace anywhere but the LINE chat.
  const isNewPayment = startsNewPayment({
    activeHasSlip: active?.hasSlip ?? false,
    activeSlipHash: active?.slipImageHash ?? null,
    incomingHasSlip: ctx.hasSlipImage,
    incomingSlipHash: ctx.slipImageHash,
  });

  // If an amount was already on record for this pending transaction (e.g.
  // stated in an earlier text message) and this call reports a different
  // one (typically the amount actually read off a slip), don't silently
  // pick one — the newer value wins (the slip is verifiable evidence) but
  // the discrepancy is surfaced to the user rather than logged unnoticed.
  // Only for the same payment: two slips of different amounts are not a
  // discrepancy, they are two payments.
  const amountMismatch =
    !isNewPayment &&
    active?.amount != null &&
    parsedAmount !== null &&
    Math.abs(active.amount - parsedAmount) > 0.005;
  const mismatchNote = amountMismatch
    ? ` Note: the amount previously on record (${formatAmount(
        active!.amount!
      )}) doesn't match the amount just reported (${formatAmount(
        parsedAmount!
      )}) — the new amount is now used. Point out this discrepancy to the user in your reply so they can correct it if it's wrong.`
    : "";

  const slipImageUrl = ctx.slipImageUrl;

  const createData = {
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
    slipTransferTime: parsedTransferTime,
    slipSenderAccount: parsedSenderAccount,
  };

  const pending =
    active && !isNewPayment
      ? await prisma.pendingTransaction.update({
          where: { id: active.id },
          data: {
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
            ...(parsedTransferTime ? { slipTransferTime: parsedTransferTime } : {}),
            ...(parsedSenderAccount ? { slipSenderAccount: parsedSenderAccount } : {}),
            // Not createdAt: that is this payment's place in the queue, and
            // rewriting it would send the payment being answered to the back.
            lastActivityAt: new Date(),
          },
        })
      : await prisma.pendingTransaction.create({ data: createData });

  // Said out loud so the member is not left wondering whether the earlier
  // slip was seen — silence there is what makes somebody send it a third time.
  const queueNote =
    isNewPayment && active
      ? ` Note: this member now has ${queued.length + 1} separate payments waiting, and this is the newest. ` +
        "Tell them, in Thai, that BOTH slips were received and neither was lost, and that the questions still being asked are about the earlier one."
      : "";

  const [lineUser, disabled] = await Promise.all([
    loadLineUser(ctx.lineUserId),
    loadDisabledRequirements(),
  ]);
  // Asked about the oldest waiting payment, not necessarily the one that just
  // arrived: the member has already been asked about that one, so switching
  // topics mid-answer would strand it.
  const asking = isNewPayment && active ? active : pending;
  const next = computeNextRequirement(lineUser, asking, disabled);
  if (next === null) {
    const result = await finalizeTransaction(ctx.lineUserId, asking, lineUser as LineUserInfo);
    return result + mismatchNote + queueNote;
  }
  return requirementMessage(next) + mismatchNote + queueNote;
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
    where: { id: pending.id },
    data: { loanType, lastActivityAt: new Date() },
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
    where: { id: pending.id },
    data: { depositAccountNumber: accountNumber, lastActivityAt: new Date() },
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
    await prisma.pendingTransaction.delete({ where: { id: pending.id } }).catch(() => {});
    return "The user said this slip is not genuinely their own transaction. Do not log it. Apologize, in Thai, and ask them to double-check and send the correct slip, or contact the cooperative office if they believe this is a mistake.";
  }

  const updated = await prisma.pendingTransaction.update({
    where: { id: pending.id },
    data: { senderNameConfirmed: true, lastActivityAt: new Date() },
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
