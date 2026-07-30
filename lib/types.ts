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
