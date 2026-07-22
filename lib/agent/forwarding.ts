// Staff-facing forwarding: resolving which officer(s) receive a service
// request or transaction notification, broadcasting LINE push messages to
// them, and recording the outcome. Split out of lib/financeAgent.ts.
import { prisma } from "../prisma";
import { lineClient } from "../lineClient";
import { pickLoanForwardTarget } from "../loanRouting";
import { pickDepartmentForwardTargets } from "../departmentRouting";
import { getCategoryDepartment } from "../categoryDepartments";
import { formatAmount } from "../format";
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
export async function resolveForwardTargets(
  lineUserId: string,
  department: string | null
): Promise<string[]> {
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
    return target ? [target] : [];
  }

  const contacts = department
    ? await prisma.departmentContact.findMany({ where: { department } })
    : [];

  return pickDepartmentForwardTargets({
    contactLineUserIds: contacts.map((c) => c.lineUserId),
    envFallback: process.env.LINE_FORWARD_GENERAL_ID ?? null,
  });
}


// Pushes the same messages to every target independently — one recipient's
// push failing (blocked bot, stale ID) never stops the others from
// receiving it. Shared by forwardServiceRequest and notifyTransactionForward.
export async function pushToTargets(
  targetIds: string[],
  messages: Parameters<typeof lineClient.pushMessage>[0]["messages"],
  logLabel: string
): Promise<{ succeededIds: string[]; failedIds: string[] }> {
  const pushResults = await Promise.allSettled(
    targetIds.map((to) => lineClient.pushMessage({ to, messages }))
  );
  const succeededIds = targetIds.filter((_, i) => pushResults[i].status === "fulfilled");
  const failedIds = targetIds.filter((_, i) => pushResults[i].status === "rejected");

  pushResults.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error(`[financeAgent] ${logLabel} push error (to ${targetIds[i]}):`, result.reason);
    }
  });

  return { succeededIds, failedIds };
}


// Writes one ServiceRequestLog row per forward attempt so staff have an
// audit trail after PendingServiceRequest is cleared. Best-effort: a
// logging failure must never change what the member is told, so errors
// are swallowed after being logged.
export async function logServiceRequest(
  lineUserId: string,
  pendingService: PendingServiceInfo,
  lineUser: LineUserInfo,
  status: "forwarded" | "failed" | "unconfigured",
  forwardedTo: string | null
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
  const targetIds = await resolveForwardTargets(lineUserId, pendingService.department);
  if (targetIds.length === 0) {
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
  const text = `📋 คำขอจากสมาชิก (ผ่าน LINE Bot)\nเอกสารที่ส่งมา: ${pendingService.documentType}\nแผนก: ${pendingService.department}\nคำขอ: ${pendingService.requestType}\nชื่อ-นามสกุล: ${lineUser.fullName}\nเลขสมาชิก: ${lineUser.memberNumber}\nเบอร์โทรติดต่อกลับ: ${lineUser.phone ?? "-"}\nสถานะ: ${verifyMark}`;

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
  const { succeededIds, failedIds } = await pushToTargets(
    targetIds,
    messages,
    "forward service request"
  );

  if (succeededIds.length === 0) {
    await logServiceRequest(lineUserId, pendingService, lineUser, "failed", targetIds.join(", "));
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
    slipImageUrl: string | null;
    slipIsPdf: boolean;
  },
  lineUser: LineUserInfo
): Promise<void> {
  try {
    const department = getCategoryDepartment(expense.category);
    const targetIds = await resolveForwardTargets(lineUserId, department);
    if (targetIds.length === 0) {
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
      .slice(0, 10)}${
      expense.depositAccountNumber ? `\nเลขที่บัญชีที่ฝาก: ${expense.depositAccountNumber}` : ""
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

    const { succeededIds, failedIds } = await pushToTargets(
      targetIds,
      messages,
      "notify transaction forward"
    );

    const forwardedTo =
      succeededIds.length === 0
        ? targetIds.join(", ")
        : failedIds.length > 0
          ? `${succeededIds.join(", ")} (failed: ${failedIds.join(", ")})`
          : succeededIds.join(", ");

    await prisma.expense.update({
      where: { id: expense.id },
      data: {
        forwardStatus: succeededIds.length > 0 ? "forwarded" : "failed",
        forwardedTo,
      },
    });
  } catch (err) {
    console.error("[financeAgent] notifyTransactionForward error:", err);
  }
}

