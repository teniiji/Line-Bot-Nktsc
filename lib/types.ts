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
  createdAt: string;
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
  status: "forwarded" | "failed" | "unconfigured";
  createdAt: string;
}
