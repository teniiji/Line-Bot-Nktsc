// Shared types for the finance agent, split out of lib/financeAgent.ts so
// the state/prompts/forwarding/handlers modules can all reference them
// without importing each other.

export type LineUserInfo = {
  fullName: string | null;
  memberNumber: string | null;
  // true when the identity came from MemberRoster keyed by this LINE
  // account's own userId (cryptographically tied to the account, can't be
  // spoofed). false when it's only what the user typed via submit_member_info.
  verified: boolean;
  // Callback phone number, collected via submit_contact_phone — only ever
  // asked for when forwarding a supporting-document service request to
  // staff, never for ordinary transaction logging.
  phone: string | null;
};


export type PendingInfo = {
  category: string | null;
  amount: number | null;
  description: string | null;
  date: Date | null;
  hasSlip: boolean;
  slipImageHash: string | null;
  slipImageUrl: string | null;
  slipIsPdf: boolean;
  referenceNumber: string | null;
  loanType: string | null;
  depositAccountNumber: string | null;
  slipSenderName: string | null;
  senderNameConfirmed: boolean;
};


export type Requirement =
  | "member_info"
  | "slip"
  | "category"
  | "loan_type"
  | "deposit_account"
  | "confirm_sender_name"
  | null;


// slipImageUrl is the best-effort Vercel Blob backup (null if
// BLOB_READ_WRITE_TOKEN isn't set or the upload failed) — never treat it as
// evidence of whether a slip was shown; use hasSlipImage for that.
export type ToolContext = {
  lineUserId: string;
  slipImageUrl: string | null;
  slipImageHash: string | null;
  hasSlipImage: boolean;
  // True when the current message's attachment (if any) is a PDF rather
  // than a photo — meaningless when hasSlipImage is false.
  slipIsPdf: boolean;
};


export type PendingServiceInfo = {
  documentType: string;
  requestType: string | null;
  department: string | null;
  imageUrl: string | null;
  imageIsPdf: boolean;
};


export type ServiceRequirement = "purpose" | "member_info" | "phone" | null;


// An in-progress "what's my member number" identity check — see
// PendingMemberLookup in schema.prisma. Independent of the transaction and
// service-request flows above; a member can ask this at any time.
export type PendingLookupInfo = {
  fullName: string | null;
  nationalId: string | null;
  phone: string | null;
};


export type LookupRequirement = "full_name" | "national_id" | "phone" | null;


export type FinanceAgentReply = { text: string; quickReplies: string[] };

