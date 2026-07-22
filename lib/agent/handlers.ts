// Tool handlers for the finance agent — one per entry in ./tools.ts,
// dispatched by executeTool at the bottom. Split out of lib/financeAgent.ts.
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { CATEGORIES } from "../categories";
import { LOAN_TYPES } from "../loanTypes";
import { DOCUMENT_TYPES } from "../documentTypes";
import { DEPARTMENTS } from "../departments";
import { formatAmount } from "../format";
import { isPlaceholderText } from "../placeholderText";
import { namesLikelyMatch } from "../nameMatch";
import { detectNamedDepartment } from "../departmentMatch";
import { matchesIdentity } from "../memberLookup";
import { classifyRecipient } from "../recipientCheck";
import {
  loadLineUser,
  loadPending,
  loadPendingServiceRequest,
  computeNextRequirement,
  computeServiceRequirement,
  computeLookupRequirement,
} from "./state";
import { forwardServiceRequest, notifyTransactionForward } from "./forwarding";
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

  const lineUser = await loadLineUser(ctx.lineUserId);
  const next = computeNextRequirement(lineUser, pending);
  if (next === null) {
    const result = await finalizeTransaction(ctx.lineUserId, pending, lineUser as LineUserInfo);
    return result + mismatchNote;
  }
  return requirementMessage(next) + mismatchNote;
}


export type SubmitMemberInfoInput = {
  fullName?: unknown;
  memberNumber?: unknown;
};


export async function submitMemberInfo(
  input: SubmitMemberInfoInput,
  ctx: ToolContext
): Promise<string> {
  const fullName = typeof input.fullName === "string" ? input.fullName.trim() : "";
  const memberNumber =
    typeof input.memberNumber === "string" ? input.memberNumber.trim() : "";
  if (isPlaceholderText(fullName) || isPlaceholderText(memberNumber)) {
    return "Error: fullName and memberNumber must be the member's actual name and number — never a placeholder like 'unknown' or '-'. If the user hasn't actually stated their real name and member number yet, ask them again, in Thai, instead of calling this tool.";
  }

  // Verify the claimed member number against the imported roster.
  const roster = await prisma.memberRoster.findUnique({ where: { memberNumber } });

  // Block impersonation: this member number is already bound to a
  // different LINE account in the roster. Do not save or proceed.
  if (roster?.lineUserId && roster.lineUserId !== ctx.lineUserId) {
    return "Error: this member number is already linked to a different LINE account. Do not proceed. Tell the user, in Thai, that this member number is registered to another LINE account, and ask them to contact the cooperative office if they believe this is a mistake.";
  }

  const verified = roster !== null;

  // Link this LINE account to the roster row the first time a known member
  // identifies, so their future messages auto-identify without asking.
  if (roster && !roster.lineUserId) {
    await prisma.memberRoster
      .update({ where: { memberNumber }, data: { lineUserId: ctx.lineUserId } })
      .catch(() => {});
  }

  const savedUser = await prisma.lineUser.upsert({
    where: { id: ctx.lineUserId },
    create: { id: ctx.lineUserId, fullName, memberNumber },
    update: { fullName, memberNumber },
  });

  // Use the roster's canonical name when verified, so a small typo in what
  // the user typed doesn't end up on the logged record. phone carries over
  // from any earlier submit_contact_phone call — this tool never touches it.
  const identity: LineUserInfo = {
    fullName: roster?.memberName ?? fullName,
    memberNumber,
    verified,
    phone: savedUser.phone,
  };
  const unverifiedNote = verified
    ? ""
    : " (Note to you: this member number is NOT in the cooperative roster, so it could not be verified — proceed, but mention gently in Thai that staff will verify their membership.)";

  const pending = await loadPending(ctx.lineUserId);
  if (pending) {
    const next = computeNextRequirement(identity, pending);
    if (next === null) {
      const result = await finalizeTransaction(ctx.lineUserId, pending, identity);
      return result + unverifiedNote;
    }
    return requirementMessage(next) + unverifiedNote;
  }

  const pendingService = await loadPendingServiceRequest(ctx.lineUserId);
  if (pendingService) {
    const next = computeServiceRequirement(identity, pendingService);
    if (next === null) {
      const result = await forwardServiceRequest(ctx.lineUserId, pendingService, identity);
      return result + unverifiedNote;
    }
    if (next === "purpose") {
      return (
        "Still missing: what request/service the supporting document is for. Ask the user next, in Thai." +
        unverifiedNote
      );
    }
    // next === "phone" — purpose and member info are both known now.
    return (
      "Still missing: a callback phone number for this request, needed to forward it. Ask the user next, in Thai." +
      unverifiedNote
    );
  }

  return `Member info saved (${fullName}, ${memberNumber}). No transaction is currently in progress — just confirm to the user that their info was saved.${unverifiedNote}`;
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

  const lineUser = await loadLineUser(ctx.lineUserId);
  const next = computeNextRequirement(lineUser, updated);
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

  const lineUser = await loadLineUser(ctx.lineUserId);
  const next = computeNextRequirement(lineUser, updated);
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

  const lineUser = await loadLineUser(ctx.lineUserId);
  const next = computeNextRequirement(lineUser, updated);
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


export type FlagSupportingDocumentInput = {
  documentType?: unknown;
};


export async function flagSupportingDocument(
  input: FlagSupportingDocumentInput,
  ctx: ToolContext
): Promise<string> {
  const documentType =
    typeof input.documentType === "string" &&
    DOCUMENT_TYPES.includes(input.documentType as (typeof DOCUMENT_TYPES)[number])
      ? input.documentType
      : null;
  if (!documentType) {
    return `Error: documentType must be one of ${DOCUMENT_TYPES.join(", ")}.`;
  }

  await prisma.pendingServiceRequest.upsert({
    where: { lineUserId: ctx.lineUserId },
    create: {
      lineUserId: ctx.lineUserId,
      documentType,
      imageUrl: ctx.slipImageUrl,
      imageIsPdf: ctx.slipIsPdf,
    },
    update: {
      documentType,
      requestType: null,
      department: null,
      imageUrl: ctx.slipImageUrl,
      imageIsPdf: ctx.slipIsPdf,
      createdAt: new Date(),
    },
  });

  return `Noted a ${documentType} document. Ask the user, politely and in Thai, what request/service this document is for. Do not decline or log anything yet.`;
}


export type SubmitServicePurposeInput = {
  purpose?: unknown;
  department?: unknown;
};


export async function submitServicePurpose(
  input: SubmitServicePurposeInput,
  ctx: ToolContext
): Promise<string> {
  const purpose = typeof input.purpose === "string" ? input.purpose.trim() : "";
  if (!purpose) {
    return "Error: purpose must be a non-empty string.";
  }
  const modelDepartment =
    typeof input.department === "string" &&
    (DEPARTMENTS as readonly string[]).includes(input.department)
      ? input.department
      : null;
  if (!modelDepartment) {
    return `Error: department must be one of ${DEPARTMENTS.join(", ")}.`;
  }
  // A department the user names outright in their own words is a stronger
  // signal than the model's topic-based guess — override rather than just
  // instructing the model to prefer it, since that instruction alone isn't
  // reliably followed in practice.
  const department = detectNamedDepartment(purpose) ?? modelDepartment;

  const pendingService = await loadPendingServiceRequest(ctx.lineUserId);
  if (!pendingService) {
    return "Error: no in-progress supporting-document flow to attach this purpose to.";
  }

  const updated = await prisma.pendingServiceRequest.update({
    where: { lineUserId: ctx.lineUserId },
    data: { requestType: purpose, department, createdAt: new Date() },
  });

  const lineUser = await loadLineUser(ctx.lineUserId);
  const next = computeServiceRequirement(lineUser, updated);
  if (next === "member_info") {
    return "Still missing: member full name and member number, needed to forward this request. Ask the user for their ชื่อ-นามสกุล and เลขสมาชิก next, in Thai.";
  }
  if (next === "phone") {
    return "Still missing: a callback phone number for this request, needed to forward it. Ask the user next, in Thai.";
  }
  return await forwardServiceRequest(ctx.lineUserId, updated, lineUser as LineUserInfo);
}


export type SubmitContactPhoneInput = {
  phone?: unknown;
};


export async function submitContactPhone(
  input: SubmitContactPhoneInput,
  ctx: ToolContext
): Promise<string> {
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  if (isPlaceholderText(phone)) {
    return "Error: phone must be the user's actual callback phone number — never a placeholder like 'unknown' or '-'. If they haven't actually stated one yet, ask them again, in Thai, instead of calling this tool.";
  }

  const pendingService = await loadPendingServiceRequest(ctx.lineUserId);
  if (!pendingService) {
    return "Error: no in-progress supporting-document flow to attach this callback phone to.";
  }

  await prisma.lineUser.upsert({
    where: { id: ctx.lineUserId },
    create: { id: ctx.lineUserId, phone },
    update: { phone },
  });

  const lineUser = await loadLineUser(ctx.lineUserId);
  const next = computeServiceRequirement(lineUser, pendingService);
  if (next === "purpose") {
    return "Still missing: what request/service the supporting document is for. Ask the user next, in Thai.";
  }
  if (next === "member_info") {
    return "Still missing: member full name and member number, needed to forward this request. Ask the user for their ชื่อ-นามสกุล and เลขสมาชิก next, in Thai.";
  }
  return await forwardServiceRequest(ctx.lineUserId, pendingService, lineUser as LineUserInfo);
}


export type SetNicknameInput = {
  nickname?: unknown;
};


export async function setNickname(
  input: SetNicknameInput,
  ctx: ToolContext
): Promise<string> {
  const nickname = typeof input.nickname === "string" ? input.nickname.trim() : "";
  if (!nickname) {
    return "Error: nickname must be a non-empty string.";
  }

  await prisma.lineUser.upsert({
    where: { id: ctx.lineUserId },
    create: { id: ctx.lineUserId, nickname },
    update: { nickname },
  });

  return `Nickname set to "${nickname}".`;
}


export type SubmitLookupInfoInput = {
  fullName?: unknown;
  nationalId?: unknown;
  phone?: unknown;
};


export async function submitLookupInfo(
  input: SubmitLookupInfoInput,
  ctx: ToolContext
): Promise<string> {
  const fullName =
    typeof input.fullName === "string" && input.fullName.trim() && !isPlaceholderText(input.fullName)
      ? input.fullName.trim()
      : null;
  const nationalId =
    typeof input.nationalId === "string" &&
    input.nationalId.trim() &&
    !isPlaceholderText(input.nationalId)
      ? input.nationalId.trim()
      : null;
  const phone =
    typeof input.phone === "string" && input.phone.trim() && !isPlaceholderText(input.phone)
      ? input.phone.trim()
      : null;

  const pending = await prisma.pendingMemberLookup.upsert({
    where: { lineUserId: ctx.lineUserId },
    create: { lineUserId: ctx.lineUserId, fullName, nationalId, phone },
    update: {
      ...(fullName ? { fullName } : {}),
      ...(nationalId ? { nationalId } : {}),
      ...(phone ? { phone } : {}),
    },
  });

  const next = computeLookupRequirement(pending);
  if (next === "full_name") {
    return "Still missing: the member's full name, needed to verify identity before revealing a member number. Ask for it next, in Thai. Do not reveal anything yet.";
  }
  if (next === "national_id") {
    return "Still missing: the member's 13-digit national ID number, needed to verify identity before revealing a member number. Ask for it next, in Thai. Do not reveal anything yet.";
  }
  if (next === "phone") {
    return "Still missing: the member's registered phone number, needed to verify identity before revealing a member number. Ask for it next, in Thai. Do not reveal anything yet.";
  }

  // All three collected — check against the roster in application code
  // rather than a DB-level exact match, since a member's own typed
  // national ID/phone formatting (dashes, spaces) won't necessarily match
  // however the source spreadsheet happened to store it. The roster is
  // small (~1,200 rows), so pulling it in full for an in-memory check is
  // simpler and more robust than trying to normalize inside SQL.
  const candidates = await prisma.memberRoster.findMany({
    select: { memberNumber: true, memberName: true, nationalId: true, phone: true },
  });
  const match = candidates.find((roster) =>
    matchesIdentity(roster, {
      fullName: pending.fullName!,
      nationalId: pending.nationalId!,
      phone: pending.phone!,
    })
  );

  await prisma.pendingMemberLookup.delete({ where: { lineUserId: ctx.lineUserId } }).catch(() => {});

  if (!match) {
    return "No roster record matched the identity info provided. Apologize to the user, in Thai, and tell them to contact the cooperative office directly to verify their identity and get their member number. Do not reveal which specific field (name/ID/phone) didn't match, and never guess or make up a member number.";
  }

  return `Verified: this member's เลขสมาชิก is ${match.memberNumber}. Tell them clearly, in Thai.`;
}


export async function executeTool(
  name: string,
  input: unknown,
  ctx: ToolContext
): Promise<string> {
  console.log(`[financeAgent] tool call: ${name}`, JSON.stringify(input));
  try {
    if (name === "report_transaction") {
      return await reportTransaction(input as ReportTransactionInput, ctx);
    }
    if (name === "submit_member_info") {
      return await submitMemberInfo(input as SubmitMemberInfoInput, ctx);
    }
    if (name === "submit_contact_phone") {
      return await submitContactPhone(input as SubmitContactPhoneInput, ctx);
    }
    if (name === "submit_loan_type") {
      return await submitLoanType(input as SubmitLoanTypeInput, ctx);
    }
    if (name === "submit_deposit_account") {
      return await submitDepositAccount(input as SubmitDepositAccountInput, ctx);
    }
    if (name === "confirm_transaction_sender") {
      return await confirmTransactionSender(input as ConfirmTransactionSenderInput, ctx);
    }
    if (name === "flag_supporting_document") {
      return await flagSupportingDocument(input as FlagSupportingDocumentInput, ctx);
    }
    if (name === "submit_service_purpose") {
      return await submitServicePurpose(input as SubmitServicePurposeInput, ctx);
    }
    if (name === "get_transaction_summary") {
      return await getTransactionSummary(input as SummaryInput, ctx.lineUserId);
    }
    if (name === "set_nickname") {
      return await setNickname(input as SetNicknameInput, ctx);
    }
    if (name === "submit_lookup_info") {
      return await submitLookupInfo(input as SubmitLookupInfoInput, ctx);
    }
    if (name === "decline_unreadable_image") {
      const reason =
        typeof (input as { reason?: unknown })?.reason === "string"
          ? (input as { reason: string }).reason
          : "unspecified";
      return `Declined: ${reason}. Explain this to the user in your reply without inventing extra details.`;
    }
    return `Unknown tool: ${name}`;
  } catch (err) {
    return `Error executing ${name}: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
}

