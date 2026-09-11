// Staff-facing forwarding: resolving which officer(s) receive a service
// request or transaction notification, broadcasting LINE push messages to
// them, and recording the outcome. Split out of lib/financeAgent.ts.
import { prisma } from "../prisma";
import { summarisePushFailures } from "../pushError";
import { lineClient } from "../lineClient";
import { pickLoanForwardTarget } from "../loanRouting";
import {
  DepartmentForwardPlan,
  planDepartmentForward,
} from "../departmentRouting";
import { getCategoryDepartment } from "../categoryDepartments";
import { formatAmount } from "../format";
import { depositAccountLine } from "../depositNotice";
import { NO_DOCUMENT } from "../documentTypes";
import { isFeatureEnabled, departmentNotifyKey } from "../featureFlags";
import type { LineUserInfo, PendingServiceInfo } from "./types";

// Picks where to forward, as one or more LINE user IDs (every non-loan
// department broadcasts to all of its assigned officers so a request isn't
// missed depending on who's on duty — see pickDepartmentForwardTargets).
// Loan requests keep the single-recipient precedence: the member's
// per-member "รหัสผู้รับผิดชอบ" code first (exact match against
// ResponsibleContact, imported from the cooperative's "ผู้รับผิดชอบ" sheet
// — more reliable than free text since it's a short code, not a typed unit
// name), then their organizational unit's confirmed contact (exact match
// against MemberRoster.unitName), falling back to LINE_FORWARD_LOAN_ID if
// neither matches. Precedence itself lives in lib/loanRouting.ts and
// lib/departmentRouting.ts so it's unit-testable without Prisma.
export async function resolveForwardPlan(
  lineUserId: string,
  department: string | null
): Promise<DepartmentForwardPlan> {
  if (department === "สินเชื่อ") {
    const roster = await prisma.memberRoster.findFirst({ where: { lineUserId } });

    const responsibleContact = roster?.responsibleCode
      ? await prisma.responsibleContact.findUnique({
          where: { code: roster.responsibleCode },
        })
      : null;
    const unitContact = roster?.unitName
      ? await prisma.loanDistrictContact.findUnique({
          where: { unitName: roster.unitName },
        })
      : null;

    const target = pickLoanForwardTarget({
      responsibleContactLineUserId: responsibleContact?.lineUserId ?? null,
      unitContactLineUserId: unitContact?.lineUserId ?? null,
      envFallback: process.env.LINE_FORWARD_LOAN_ID ?? null,
    });
    // Loan requests stay one named officer with no fallback: the precedence
    // above already picks the person who owns this member's case, and a
    // second-choice recipient for a loan enquiry is not a safety net, it is
    // somebody else's business.
    return { primary: target ? [target] : [], fallback: [], viaGroup: false };
  }

  const contacts = department
    ? await prisma.departmentContact.findMany({ where: { department } })
    : [];

  return planDepartmentForward({
    contactLineUserIds: contacts.map((c) => c.lineUserId),
    envFallback: process.env.LINE_FORWARD_GENERAL_ID ?? null,
  });
}

// Every recipient a plan could reach, for the log line written when none of
// them worked.
export function allPlanTargets(plan: DepartmentForwardPlan): string[] {
  return [...plan.primary, ...plan.fallback];
}

// Prepended to a fallback push so the officer who receives it knows why it
// came to them and that the group needs fixing — otherwise the group quietly
// stops working and the only sign is that the old recipients are busy again.
const FALLBACK_NOTICE =
  "⚠️ ส่งเข้ากลุ่มไม่สำเร็จ (บอทอาจถูกนำออกจากกลุ่มแล้ว) จึงส่งให้คุณโดยตรงแทน — " +
  "รบกวนตรวจที่แดชบอร์ด > ผู้รับผิดชอบ > กลุ่ม LINE";

// Pushes to the plan's primary, and only if every one of those failed, to
// the fallback. Returns the same shape as pushToTargets so callers log and
// report exactly as before.
export async function pushToPlan(
  plan: DepartmentForwardPlan,
  messages: Parameters<typeof lineClient.pushMessage>[0]["messages"],
  logLabel: string
): Promise<PushOutcome> {
  const first = await pushToTargets(plan.primary, messages, logLabel);
  if (first.succeededIds.length > 0 || plan.fallback.length === 0) return first;

  console.warn(
    `[financeAgent] ${logLabel}: primary targets all failed, falling back to ${plan.fallback.length} recipient(s)`
  );
  const second = await pushToTargets(
    plan.fallback,
    [{ type: "text", text: FALLBACK_NOTICE }, ...messages],
    `${logLabel} (fallback)`
  );

  return {
    succeededIds: second.succeededIds,
    failedIds: [...first.failedIds, ...second.failedIds],
    errors: [...first.errors, ...second.errors],
  };
}


// Pushes the same messages to every target independently — one recipient's
// push failing (blocked bot, stale ID) never stops the others from
// receiving it. Shared by forwardServiceRequest and notifyTransactionForward.
export interface PushOutcome {
  succeededIds: string[];
  failedIds: string[];
  // What LINE said about each failure, in the order they failed. Carried out
  // rather than only logged: the reason is the difference between "ring the
  // office and hope" and "add the officer as a friend and it works".
  errors: unknown[];
}

export async function pushToTargets(
  targetIds: string[],
  messages: Parameters<typeof lineClient.pushMessage>[0]["messages"],
  logLabel: string
): Promise<PushOutcome> {
  const pushResults = await Promise.allSettled(
    targetIds.map((to) => lineClient.pushMessage({ to, messages }))
  );
  const succeededIds = targetIds.filter((_, i) => pushResults[i].status === "fulfilled");
  const failedIds = targetIds.filter((_, i) => pushResults[i].status === "rejected");
  const errors = pushResults
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);

  pushResults.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error(`[financeAgent] ${logLabel} push error (to ${targetIds[i]}):`, result.reason);
    }
  });

  return { succeededIds, failedIds, errors };
}


// Writes one ServiceRequestLog row per forward attempt so staff have an
// audit trail after PendingServiceRequest is cleared. Best-effort: a
// logging failure must never change what the member is told, so errors
// are swallowed after being logged.
export async function logServiceRequest(
  lineUserId: string,
  pendingService: PendingServiceInfo,
  lineUser: LineUserInfo,
  status: "forwarded" | "failed" | "unconfigured" | "muted",
  forwardedTo: string | null,
  forwardError: string | null = null
): Promise<void> {
  try {
    await prisma.serviceRequestLog.create({
      data: {
        lineUserId,
        memberFullName: lineUser.fullName ?? null,
        memberNumber: lineUser.memberNumber ?? null,
        memberVerified: lineUser.verified ?? false,
        phone: lineUser.phone ?? null,
        documentType: pendingService.documentType,
        requestType: pendingService.requestType,
        department: pendingService.department,
        imageUrl: pendingService.imageUrl,
        imageIsPdf: pendingService.imageIsPdf,
        forwardedTo,
        forwardError,
        status,
      },
    });
  } catch (err) {
    console.error("[financeAgent] service request log write error:", err);
  }
}


// Pushes the collected request to the resolved target and clears the
// pending record. If forwarding isn't configured or fails, the user is
// told honestly instead of being falsely reassured that staff were
// notified.
export async function forwardServiceRequest(
  lineUserId: string,
  pendingService: PendingServiceInfo,
  lineUser: LineUserInfo
): Promise<string> {
  // Staff-toggleable per-department mute (dashboard > ตั้งค่าระบบ) — the
  // request is still logged (so nothing is lost), just not pushed. Checked
  // before resolveForwardTargets so a muted department's contacts aren't
  // even looked up.
  if (
    pendingService.department &&
    !(await isFeatureEnabled(departmentNotifyKey(pendingService.department)))
  ) {
    await logServiceRequest(lineUserId, pendingService, lineUser, "muted", null);
    await prisma.pendingServiceRequest.delete({ where: { lineUserId } }).catch(() => {});
    return "The request was recorded, but staff have temporarily paused push notifications for this department (a deliberate setting, not a configuration problem). Tell the user, in Thai, that their request has been received and staff will follow up — do not mention the pause itself.";
  }

  const plan = await resolveForwardPlan(lineUserId, pendingService.department);
  if (allPlanTargets(plan).length === 0) {
    await logServiceRequest(lineUserId, pendingService, lineUser, "unconfigured", null);
    await prisma.pendingServiceRequest.delete({ where: { lineUserId } }).catch(() => {});
    console.warn(
      "[financeAgent] no forward target configured — service request not forwarded:",
      JSON.stringify(pendingService)
    );
    return "Error: forwarding isn't configured on this system. Apologize to the user and tell them to contact the cooperative office directly instead — do not claim the request was forwarded.";
  }

  const verifyMark = lineUser.verified
    ? "✅ ยืนยันตัวตนจากทะเบียน"
    : "⚠️ ยังไม่ยืนยัน (เลขสมาชิกไม่พบในทะเบียน — กรุณาตรวจสอบ)";
  const documentLine =
    pendingService.documentType === NO_DOCUMENT
      ? ""
      : `เอกสารที่ส่งมา: ${pendingService.documentType}\n`;
  const text = `📋 คำขอจากสมาชิก (ผ่าน LINE Bot)\n${documentLine}แผนก: ${pendingService.department}\nคำขอ: ${pendingService.requestType}\nชื่อ-นามสกุล: ${lineUser.fullName}\nเลขสมาชิก: ${lineUser.memberNumber}\nเบอร์โทรติดต่อกลับ: ${lineUser.phone ?? "-"}\nสถานะ: ${verifyMark}`;

  // imageUrl is the best-effort Blob backup of the document the member
  // sent (null if BLOB_READ_WRITE_TOKEN isn't configured). LINE's
  // Messaging API can only push a real photo as an "image" message (it
  // fetches and thumbnails the URL) — a PDF isn't a valid image message,
  // so it's sent as a plain text link instead.
  const messages: Parameters<typeof lineClient.pushMessage>[0]["messages"] =
    pendingService.imageUrl
      ? pendingService.imageIsPdf
        ? [{ type: "text", text: `${text}\n📎 ไฟล์เอกสาร (PDF): ${pendingService.imageUrl}` }]
        : [
            { type: "text", text },
            {
              type: "image",
              originalContentUrl: pendingService.imageUrl,
              previewImageUrl: pendingService.imageUrl,
            },
          ]
      : [{ type: "text", text }];

  // The member is only told forwarding failed if every recipient failed; a
  // partial failure is still logged so staff can spot and fix the stale
  // contact from the dashboard.
  const { succeededIds, failedIds, errors } = await pushToPlan(
    plan,
    messages,
    "forward service request"
  );

  if (succeededIds.length === 0) {
    await logServiceRequest(
      lineUserId,
      pendingService,
      lineUser,
      "failed",
      allPlanTargets(plan).join(", "),
      summarisePushFailures(errors)
    );
    await prisma.pendingServiceRequest.delete({ where: { lineUserId } }).catch(() => {});
    return "Error: failed to forward the request. Apologize to the user and tell them to contact the cooperative office directly instead — do not claim the request was forwarded.";
  }

  const forwardedTo =
    failedIds.length > 0
      ? `${succeededIds.join(", ")} (failed: ${failedIds.join(", ")})`
      : succeededIds.join(", ");
  await logServiceRequest(lineUserId, pendingService, lineUser, "forwarded", forwardedTo);
  await prisma.pendingServiceRequest.delete({ where: { lineUserId } }).catch(() => {});
  return `Forwarded to the relevant department: "${pendingService.requestType}" for member ${lineUser.fullName} (${lineUser.memberNumber}). Confirm to the user, in Thai, that their request was sent and staff will contact them.`;
}


// Best-effort staff notification for a just-logged transaction — resolves
// a department from the transaction's category (CATEGORY_DEPARTMENTS) and
// broadcasts to it the same way forwardServiceRequest does (reusing
// resolveForwardTargets, so "ชำระเก็บไม่ได้รายเดือน" routes through the
// same per-member loan-officer precedence as สินเชื่อ service requests).
// Never blocks or changes what the member is told — the outcome is only
// recorded on the Expense row for staff to notice from the dashboard.
export async function notifyTransactionForward(
  lineUserId: string,
  expense: {
    id: string;
    category: string;
    amount: number;
    description: string | null;
    date: Date;
    loanType: string | null;
    depositAccountNumber: string | null;
    slipSenderName: string | null;
    senderNameMismatch: boolean;
    slipTransferTime: string | null;
    slipSenderAccount: string | null;
    slipImageUrl: string | null;
    slipIsPdf: boolean;
  },
  lineUser: LineUserInfo
): Promise<void> {
  try {
    const department = getCategoryDepartment(expense.category);

    // Staff-toggleable per-department mute (dashboard > ตั้งค่าระบบ) — the
    // transaction itself is already logged by the time this runs, so muting
    // only skips the push notification, never the record.
    if (department && !(await isFeatureEnabled(departmentNotifyKey(department)))) {
      await prisma.expense.update({
        where: { id: expense.id },
        data: { forwardStatus: "muted", forwardedTo: null },
      });
      return;
    }

    const plan = await resolveForwardPlan(lineUserId, department);
    if (allPlanTargets(plan).length === 0) {
      await prisma.expense.update({
        where: { id: expense.id },
        data: { forwardStatus: "unconfigured", forwardedTo: null },
      });
      return;
    }

    const verifyMark = lineUser.verified
      ? "✅ ยืนยันตัวตนจากทะเบียน"
      : "⚠️ ยังไม่ยืนยัน (เลขสมาชิกไม่พบในทะเบียน — กรุณาตรวจสอบ)";
    const text = `💰 มีรายการธุรกรรมใหม่ (ผ่าน LINE Bot)\nประเภท: ${expense.category}${
      expense.loanType ? ` (${expense.loanType})` : ""
    }\nจำนวนเงิน: ${formatAmount(expense.amount)}\nวันที่: ${expense.date
      .toISOString()
      .slice(0, 10)}${expense.slipTransferTime ? ` ${expense.slipTransferTime} น.` : ""}${
      // The account the money left, exactly as the slip printed it. Staff read
      // this straight across to the bank statement, so the mask stays.
      expense.slipSenderAccount ? `\nบัญชีผู้โอน: ${expense.slipSenderAccount}` : ""
    }${
      // Said either way for a deposit — see lib/depositNotice.ts for why a
      // missing account has to be stated rather than left as a blank space.
      depositAccountLine(expense.category, expense.depositAccountNumber)
    }${
      expense.description ? `\nหมายเหตุ: ${expense.description}` : ""
    }\nชื่อ-นามสกุล: ${lineUser.fullName}\nเลขสมาชิก: ${lineUser.memberNumber}\nสถานะ: ${verifyMark}${
      expense.senderNameMismatch
        ? `\n⚠️ ชื่อในสลิป ("${expense.slipSenderName}") ไม่ตรงกับชื่อสมาชิก — สมาชิกยืนยันแล้วว่าเป็นธุรกรรมของตัวเอง แต่ควรตรวจสอบเพิ่มเติม`
        : ""
    }`;

    // slipImageUrl is the same best-effort Blob backup used for report
    // slips generally (null if BLOB_READ_WRITE_TOKEN isn't configured).
    // LINE's Messaging API can only push a real photo as an "image"
    // message (it fetches and thumbnails the URL) — a PDF isn't a valid
    // image message, so it's sent as a plain text link instead.
    const messages: Parameters<typeof lineClient.pushMessage>[0]["messages"] =
      expense.slipImageUrl
        ? expense.slipIsPdf
          ? [{ type: "text", text: `${text}\n📎 ไฟล์สลิป (PDF): ${expense.slipImageUrl}` }]
          : [
              { type: "text", text },
              {
                type: "image",
                originalContentUrl: expense.slipImageUrl,
                previewImageUrl: expense.slipImageUrl,
              },
            ]
        : [{ type: "text", text }];

    const { succeededIds, failedIds, errors } = await pushToPlan(
      plan,
      messages,
      "notify transaction forward"
    );

    const forwardedTo =
      succeededIds.length === 0
        ? allPlanTargets(plan).join(", ")
        : failedIds.length > 0
          ? `${succeededIds.join(", ")} (failed: ${failedIds.join(", ")})`
          : succeededIds.join(", ");

    await prisma.expense.update({
      where: { id: expense.id },
      data: {
        forwardStatus: succeededIds.length > 0 ? "forwarded" : "failed",
        forwardedTo,
        forwardError: succeededIds.length > 0 ? null : summarisePushFailures(errors),
      },
    });
  } catch (err) {
    console.error("[financeAgent] notifyTransactionForward error:", err);
  }
}

