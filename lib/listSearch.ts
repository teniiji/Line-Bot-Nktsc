// Finding one row in a list the dashboard shows in full.
//
// Three of these lists are long enough that reading them is the work: the
// units in a รายการหัก round (105 of them), the form links (60-odd) and the
// knowledge entries. Each is rendered whole, in one order, with no way in but
// the scrollbar — so "which units still have no file" is answered by
// eleven screens of eye-work, once a month, every month, and a form link is
// edited by scrolling until its name goes past.
//
// The rule is the one the statement tables already use, and it is deliberately
// the same rule: every word typed has to match, so a second word narrows the
// list instead of widening it, and the search runs over everything the row
// puts on screen rather than over a chosen column. A person searching does
// not first decide which field their fragment belongs to, and requiring them
// to is how a search box gets abandoned.

import { formatAmount } from "./format";
import type { DeductionUnitRow } from "./types";

/**
 * Every word has to match, not any of them: "เซกา ยังไม่ส่ง" means both.
 * The haystack is expected to be lowercase already.
 */
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


// What staff are actually looking for in a round, as one choice rather than
// as a search term: the four of these are the round's own working states, and
// "which ones still have no file" is the question the month starts with.
export type UnitFilter = "all" | "noFile" | "hasFile" | "sent" | "unsent";

export const UNIT_FILTER_LABELS: Record<UnitFilter, string> = {
  all: "ทั้งหมด",
  noFile: "ยังไม่มีไฟล์",
  hasFile: "มีไฟล์แล้ว",
  unsent: "ยังไม่ส่ง",
  sent: "ส่งแล้ว",
};

// The order they appear as buttons — the month's work, left to right.
export const UNIT_FILTERS: UnitFilter[] = ["all", "noFile", "hasFile", "unsent", "sent"];

export function matchesUnitFilter(row: DeductionUnitRow, filter: UnitFilter): boolean {
  switch (filter) {
    case "noFile":
      return !row.fileName;
    case "hasFile":
      return Boolean(row.fileName);
    case "sent":
      return row.sendStatus === "sent";
    // A unit that was skipped on purpose is not outstanding work, so it is no
    // part of "ยังไม่ส่ง" — the point of the button is the list still to do.
    case "unsent":
      return row.sendStatus !== "sent" && row.sendStatus !== "skipped";
    case "all":
      return true;
  }
}

// Everything the row shows, including the things staff search by that are not
// columns of their own: the contact's email, the file's name, and the status
// as it is written on screen rather than as it is stored.
export function unitHaystack(
  row: DeductionUnitRow,
  statusLabel: (status: string) => string = (status) => status
): string {
  return [
    row.unitName,
    row.groupName ?? "",
    row.contactName ?? "",
    row.email ?? "",
    row.fileName ?? "",
    row.amount === null ? "" : `${row.amount} ${formatAmount(row.amount)}`,
    statusLabel(row.sendStatus),
    row.hasLineId ? "มี line" : "ไม่มี line",
  ]
    .join(" ")
    .toLowerCase();
}

export function filterUnits(
  rows: readonly DeductionUnitRow[],
  query: string,
  filter: UnitFilter,
  statusLabel?: (status: string) => string
): DeductionUnitRow[] {
  return filterBy(
    rows.filter((row) => matchesUnitFilter(row, filter)),
    query,
    (row) => unitHaystack(row, statusLabel)
  );
}


// The form link's key is searchable as well as its name: staff who maintain
// this list know some of them by key, because that is what the bot matches on.
export function formLinkHaystack(link: {
  key: string;
  label: string;
  url: string;
}): string {
  return `${link.key} ${link.label} ${link.url}`.toLowerCase();
}

// The knowledge entry's whole text, not just its heading — "042-411334" and
// "ฌาปนกิจ" are both things staff come here to find, and neither is a title.
export function knowledgeHaystack(entry: {
  key: string;
  title: string;
  content: string;
}): string {
  return `${entry.key} ${entry.title} ${entry.content}`.toLowerCase();
}
