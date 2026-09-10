// Which bank accounts a member pays from.
//
// Two sources, the same two the daily reconciliation uses. MemberBankAccount
// is the directory staff maintain by hand; StatementMember carries an account
// number for most members of every หักไม่ได้ round, which is far more rows but
// less deliberate. Both are needed: the directory alone knows only the members
// somebody has bound, and the rounds alone go stale between them.
//
// Member numbers are compared as members rather than as strings. The two
// sources are written by different hands and "029262" and "29262" are one
// member — see lib/memberNumber.ts for the ฿4,200 that cost.

import { memberNumberKey } from "./memberNumber";

export interface AccountRow {
  accountNumber: string | null;
  memberNumber: string;
}

/**
 * Every account either source attributes to this member, in a stable order so
 * the same query twice gives the same answer.
 */
export function accountsForMember(
  sources: AccountRow[][],
  memberNumber: string
): string[] {
  const wanted = memberNumberKey(memberNumber);
  if (!wanted) return [];

  const accounts = new Set<string>();
  for (const rows of sources) {
    for (const row of rows) {
      if (!row.accountNumber) continue;
      if (memberNumberKey(row.memberNumber) !== wanted) continue;
      accounts.add(row.accountNumber);
    }
  }
  return [...accounts].sort();
}
