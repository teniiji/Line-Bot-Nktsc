// Dispatches a tool call from ./tools.ts to its handler. The handlers
// themselves are grouped by what they're about, since they were one 949-line
// file and the three flows barely touch each other:
//   ./transactionHandlers.ts    — recording a slip into an Expense
//   ./serviceRequestHandlers.ts — forwarding a request to the right department
//   ./identityHandlers.ts       — who the member is (feeds both of the above)
// Everything is re-exported here so ./handlers stays the single import point.
import {
  reportTransaction,
  submitLoanType,
  submitDepositAccount,
  confirmTransactionSender,
  getTransactionSummary,
  type ReportTransactionInput,
  type SubmitLoanTypeInput,
  type SubmitDepositAccountInput,
  type ConfirmTransactionSenderInput,
  type SummaryInput,
} from "./transactionHandlers";
import {
  flagSupportingDocument,
  submitServicePurpose,
  requestStaffHelp,
  submitContactPhone,
  type FlagSupportingDocumentInput,
  type SubmitServicePurposeInput,
  type RequestStaffHelpInput,
  type SubmitContactPhoneInput,
} from "./serviceRequestHandlers";
import {
  submitMemberInfo,
  setNickname,
  submitLookupInfo,
  type SubmitMemberInfoInput,
  type SetNicknameInput,
  type SubmitLookupInfoInput,
} from "./identityHandlers";
import type { ToolContext } from "./types";

export * from "./transactionHandlers";
export * from "./serviceRequestHandlers";
export * from "./identityHandlers";

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
    if (name === "request_staff_help") {
      return await requestStaffHelp(input as RequestStaffHelpInput, ctx);
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

