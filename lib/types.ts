export interface Expense {
  id: string;
  amount: number;
  category: string;
  description: string | null;
  date: string;
  createdAt: string;
  memberFullName: string | null;
  memberNumber: string | null;
  memberVerified: boolean;
  loanType: string | null;
  depositAccountNumber: string | null;
  slipSenderName: string | null;
  senderNameMismatch: boolean;
  // Outcome of the staff notification push for this transaction. "muted"
  // means staff deliberately turned that department's notifications off
  // (dept_notify_* flag), so it isn't a problem to flag.
  forwardStatus: "forwarded" | "failed" | "unconfigured" | "muted";
  forwardedTo: string | null;
  user: { displayName: string | null; nickname: string | null } | null;
}

export interface ExpenseSummary {
  total: number;
  thisMonth: number;
  topCategory: string | null;
  byCategory: { category: string; total: number }[];
  monthlyTrend: { month: string; total: number }[];
}

export interface LineUser {
  id: string;
  displayName: string | null;
  nickname: string | null;
  // Set once a member has gone through report_transaction's identity step
  // (submit_member_info) — null for anyone who has only ever asked a
  // general question. unitName is never null on LineUser itself (it isn't
  // a column there); the API joins it in from MemberRoster by
  // memberNumber, so it's null both when memberNumber is unknown and when
  // MemberRoster has no unitName recorded for that member.
  fullName: string | null;
  memberNumber: string | null;
  unitName: string | null;
  botPaused: boolean;
  createdAt: string;
}

export interface MemberRosterEntry {
  id: string;
  memberNumber: string;
  memberName: string;
  unitName: string | null;
  nationalId: string | null;
  phone: string | null;
  // The LINE account this member is bound to, once they've identified
  // themselves to the bot at least once. Staff can only clear it, never set
  // it — see the PUT handler in app/api/member-roster/[memberNumber].
  lineUserId: string | null;
}

export interface ServiceRequestLogEntry {
  id: string;
  lineUserId: string;
  memberFullName: string | null;
  memberNumber: string | null;
  memberVerified: boolean;
  phone: string | null;
  documentType: string;
  requestType: string | null;
  department: string | null;
  imageUrl: string | null;
  forwardedTo: string | null;
  status: "forwarded" | "failed" | "unconfigured" | "muted";
  createdAt: string;
}

export interface FeatureFlagEntry {
  id: string;
  key: string;
  label: string;
  enabled: boolean;
  updatedAt: string;
}

// A month's round of รายการหัก plus how far along it is, for the round
// switcher in DeductionRoundsPanel.
export interface DeductionRoundSummary {
  id: string;
  period: string;
  label: string;
  note: string | null;
  closedAt: string | null;
  createdAt: string;
  totalUnits: number;
  readyUnits: number;
  sentUnits: number;
  failedUnits: number;
}

// One unit's row within a round. Contact details are joined in from
// OrganizationUnit by the API — hasLineId rather than the id itself, since
// the table only needs to know whether LINE delivery is possible.
export interface DeductionUnitRow {
  id: string;
  unitName: string;
  groupName: string | null;
  contactName: string | null;
  email: string | null;
  hasLineId: boolean;
  contactMethod: string | null;
  fileName: string | null;
  fileUrl: string | null;
  amount: number | null;
  memberCount: number | null;
  sendStatus: string;
  sentAt: string | null;
  sentVia: string | null;
  sendError: string | null;
}

// A unit that receives รายการหัก each month, with the contact details the
// send step uses. Editable from the dashboard (OrganizationUnitsPanel) as
// well as by scripts/import-org-data.ts.
export interface OrganizationUnitEntry {
  id: string;
  name: string;
  groupName: string | null;
  contactName: string | null;
  email: string | null;
  lineUserId: string | null;
  contactMethod: string | null;
  note: string | null;
}

export interface StatementRoundSummary {
  id: string;
  period: string;
  label: string;
  createdAt: string;
  totalMembers: number;
  paidMembers: number;
  overpaidMembers: number;
  unpaidMembers: number;
  // Units in the uploaded sheet that had not reported a deduction result yet.
  // Their members are not on the round's list — nobody knows whether they
  // paid — so the round only covers part of the month until they come in.
  awaitingUnits: number;
  awaitingMembers: number;
  awaitingAmount: number;
}

export interface StatementMemberRow {
  id: string;
  memberNumber: string;
  name: string;
  unitName: string | null;
  hCode: string | null;
  note: string | null;
  accountNumber: string | null;
  amountDue: number;
  amountPaid: number;
  paidAt: string | null;
  paidBranch: string | null;
  status: string;
}

// One entry in the directory of "this bank account belongs to this member".
export interface MemberBankAccountEntry {
  id: string;
  accountNumber: string;
  memberNumber: string;
  memberName: string | null;
  unitName: string | null;
  inRoster: boolean;
  note: string | null;
  updatedAt: string;
}

// One statement file a round has been built from. Uploads accumulate, so
// this is how staff see what is already loaded before adding the next export.
export interface StatementFileSummary {
  account: string;
  branch: string;
  sourceFile: string | null;
  transfers: number;
  amount: number;
}

// One line read out of a bank statement, with everything the tab needs to
// decide whether it was really paying off a failed deduction.
export interface StatementTransferRow {
  id: string;
  memberNumber: string | null;
  accountNumber: string;
  amount: number;
  transferredAt: string | null;
  branch: string | null;
  description: string | null;
  // Set once staff say this money was for ซื้อหุ้น, ชำระหนี้, ฝากเงิน …
  excludedReason: string | null;
  // A slip the member filed through the bot under some other purpose that
  // lines up with this transfer — a prompt to check, never a decision.
  slipHint: { category: string; amount: number; date: string } | null;
}

// A transfer that matched nobody on the round's list — money that arrived
// under an account number the หักไม่ได้ sheet doesn't carry.
export interface StatementUnmatchedRow {
  id: string;
  accountNumber: string;
  amount: number;
  transferredAt: string | null;
  branch: string | null;
  description: string | null;
}
