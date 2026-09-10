// Finding one line in a statement.
//
// A day can run to a couple of hundred lines and a month to thousands, and
// the question a person brings to this table is almost always about one of
// them: the ฿30,000 that came in around eleven, the transfer from account
// 4131579286, everything belonging to member 13140. Scrolling for it defeats
// the point of showing the file in the bank's own order.
//
// So the search runs over everything the row shows — the same text the eye
// would be scanning — rather than over a chosen column. A person searching
// does not first decide which field their fragment belongs to, and requiring
// them to is how a search box gets abandoned.

import { formatAmount, formatStatementDate, formatStatementTimeExact } from "./format";
import { STATUS_LABELS, type StatementLineStatus } from "./statementDayView";
import { CHANNEL_LABELS } from "./statementLines";
import type { DailyDepositRow, DailyOtherLineRow, DailySlipRow } from "./types";

export interface SearchableStatementRow {
  postedAt: string | null;
  txnCode: string;
  description: string;
  amount: number;
  balance: number | null;
  account: string;
  branch: string;
  senderAccount: string | null;
  memberNumber: string | null;
  memberName: string | null;
  unitName: string | null;
  status: StatementLineStatus;
}

// Everything the row puts on screen, as one lowercase string. The amount goes
// in twice on purpose: as the bank's own digits ("30000") and as the table
// renders it ("฿30,000.00"), so both a typed 30000 and a copied 30,000 land.
export function statementRowHaystack(row: SearchableStatementRow): string {
  return [
    formatStatementDate(row.postedAt),
    formatStatementTimeExact(row.postedAt),
    row.txnCode,
    row.description,
    String(row.amount),
    formatAmount(row.amount),
    row.balance === null ? "" : String(row.balance),
    row.account,
    row.branch,
    row.senderAccount ?? "",
    row.memberNumber ?? "",
    row.memberName ?? "",
    row.unitName ?? "",
    STATUS_LABELS[row.status],
  ]
    .join(" ")
    .toLowerCase();
}

// Every word has to match, not any of them: "30000 บึงกาฬ" means both, which
// is what makes a second word narrow the list instead of widening it.
export function matchesStatementSearch(row: SearchableStatementRow, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = statementRowHaystack(row);
  return terms.every((term) => haystack.includes(term));
}

export function filterStatementRows<T extends SearchableStatementRow>(
  rows: readonly T[],
  query: string
): T[] {
  if (!query.trim()) return [...rows];
  return rows.filter((row) => matchesStatementSearch(row, query));
}


// Every word has to match, not any of them — see matchesStatementSearch. The
// same rule for every section, because a search box that behaves differently
// depending on which table it is over is worse than none.
export function matchesTerms(haystack: string, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  return terms.every((term) => haystack.includes(term));
}

export function filterBy<T>(
  rows: readonly T[],
  query: string,
  haystackOf: (row: T) => string
): T[] {
  if (!query.trim()) return [...rows];
  return rows.filter((row) => matchesTerms(haystackOf(row).toLowerCase(), query));
}

// The amount twice in each of these, for the same reason as the statement
// rows: as typed and as displayed.
const amountForms = (amount: number) => [String(amount), formatAmount(amount)];

export function depositHaystack(row: DailyDepositRow): string {
  return [
    formatStatementDate(row.postedAt),
    formatStatementTimeExact(row.postedAt),
    ...amountForms(row.amount),
    row.memberNumber ?? "",
    row.senderAccount ?? "",
    CHANNEL_LABELS[row.channel] ?? row.channel,
    row.branch,
    row.description,
  ]
    .join(" ")
    .toLowerCase();
}

export function slipHaystack(row: DailySlipRow): string {
  return [
    formatStatementDate(row.date),
    row.transferTime ?? "",
    ...amountForms(row.amount),
    row.memberNumber ?? "",
    row.memberFullName ?? "",
    row.category ?? "",
    row.senderAccount ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

export function otherLineHaystack(row: DailyOtherLineRow): string {
  return [
    formatStatementDate(row.postedAt),
    formatStatementTimeExact(row.postedAt),
    ...amountForms(row.amount),
    row.txnCode,
    row.description,
    row.branch,
  ]
    .join(" ")
    .toLowerCase();
}

// A matched row shows both halves, so both halves are searchable: the member
// name only exists on the slip, and the bank's description only on the
// deposit, and a person searching does not know or care which is which.
export function matchedPairHaystack(pair: {
  deposit: DailyDepositRow;
  slip: DailySlipRow;
}): string {
  return `${depositHaystack(pair.deposit)} ${slipHaystack(pair.slip)}`;
}
