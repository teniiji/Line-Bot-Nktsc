// Tool handlers for the service-request flow: a member sends a supporting
// document (or just asks for help with no document at all), the bot works out
// what they want and which department owns it, then collects the identity and
// callback number staff need before forwarding. Split out of ./handlers.ts.
import { prisma } from "../prisma";
import { DOCUMENT_TYPES, NO_DOCUMENT } from "../documentTypes";
import { DEPARTMENTS } from "../departments";
import { isPlaceholderText } from "../placeholderText";
import { detectNamedDepartment } from "../departmentMatch";
import { isFeatureEnabled, SERVICE_REQUESTS_ENABLED } from "../featureFlags";
import {
  loadLineUser,
  loadPendingServiceRequest,
  computeServiceRequirement,
} from "./state";
import { forwardServiceRequest } from "./forwarding";
import type { LineUserInfo, PendingServiceInfo, ToolContext } from "./types";
export type FlagSupportingDocumentInput = {
  documentType?: unknown;
};


export async function flagSupportingDocument(
  input: FlagSupportingDocumentInput,
  ctx: ToolContext
): Promise<string> {
  // Staff-toggleable (dashboard > ตั้งค่าระบบ) — checked before creating any
  // pending state so a document sent while paused never starts a flow.
  if (!(await isFeatureEnabled(SERVICE_REQUESTS_ENABLED))) {
    return "Error: service requests are temporarily paused by staff. Apologize to the user, in Thai, and tell them to try again later or contact the cooperative office directly — do not start collecting any info for this request.";
  }

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


// Shared by every tool handler that might supply the last missing piece of
// a service request (purpose+department, member info, or phone) — checks
// what's still needed and either asks for it or forwards. Both the
// document-triggered flow (submitServicePurpose) and the text-only flow
// (requestStaffHelp) reach this once purpose+department are known.
async function advanceServiceRequest(
  lineUserId: string,
  pendingService: PendingServiceInfo
): Promise<string> {
  const lineUser = await loadLineUser(lineUserId);
  const next = computeServiceRequirement(lineUser, pendingService);
  if (next === "member_info") {
    return "Still missing: member full name and member number, needed to forward this request. Ask the user for their ชื่อ-นามสกุล and เลขสมาชิก next, in Thai.";
  }
  if (next === "phone") {
    return "Still missing: a callback phone number for this request, needed to forward it. Ask the user next, in Thai.";
  }
  return await forwardServiceRequest(lineUserId, pendingService, lineUser as LineUserInfo);
}


// A department the user names outright in their own words is a stronger
// signal than the model's topic-based guess — override rather than just
// instructing the model to prefer it, since that instruction alone isn't
// reliably followed in practice. Shared by submitServicePurpose and
// requestStaffHelp.
function resolveDepartment(purpose: string, modelDepartment: string): string {
  return detectNamedDepartment(purpose) ?? modelDepartment;
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
  const department = resolveDepartment(purpose, modelDepartment);

  const pendingService = await loadPendingServiceRequest(ctx.lineUserId);
  if (!pendingService) {
    return "Error: no in-progress supporting-document flow to attach this purpose to.";
  }

  const updated = await prisma.pendingServiceRequest.update({
    where: { lineUserId: ctx.lineUserId },
    data: { requestType: purpose, department, createdAt: new Date() },
  });

  return await advanceServiceRequest(ctx.lineUserId, updated);
}


export type RequestStaffHelpInput = {
  purpose?: unknown;
  department?: unknown;
};


// Starts the same identity + callback-phone collection and forwarding flow
// as submitServicePurpose, but for a request that has no document attached
// at all (e.g. a forgotten password) — creates the PendingServiceRequest
// row itself instead of requiring flag_supporting_document to have created
// one first.
export async function requestStaffHelp(
  input: RequestStaffHelpInput,
  ctx: ToolContext
): Promise<string> {
  // Staff-toggleable (dashboard > ตั้งค่าระบบ) — same switch as
  // flagSupportingDocument, since this is the text-only entry point to the
  // same service-request flow.
  if (!(await isFeatureEnabled(SERVICE_REQUESTS_ENABLED))) {
    return "Error: service requests are temporarily paused by staff. Apologize to the user, in Thai, and tell them to try again later or contact the cooperative office directly — do not start collecting any info for this request.";
  }

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
  const department = resolveDepartment(purpose, modelDepartment);

  const updated = await prisma.pendingServiceRequest.upsert({
    where: { lineUserId: ctx.lineUserId },
    create: {
      lineUserId: ctx.lineUserId,
      documentType: NO_DOCUMENT,
      requestType: purpose,
      department,
      imageUrl: null,
      imageIsPdf: false,
    },
    update: {
      documentType: NO_DOCUMENT,
      requestType: purpose,
      department,
      imageUrl: null,
      imageIsPdf: false,
      createdAt: new Date(),
    },
  });

  return await advanceServiceRequest(ctx.lineUserId, updated);
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
