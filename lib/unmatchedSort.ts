// Ordering the money nobody has placed yet.
//
// The list arrives newest first, which is the right answer to "what came in
// today" and the wrong one to every question staff actually work through it
// with. Chasing a ฿24,600 transfer is worth a phone call in a way that ฿1,100
// is not. An account that appears three times is one lookup that clears three
// rows. Two accounts differing in the last digit are two different members,
// and only sit next to each other when the list is by account number.
//
// So the order is the person's to choose, and every one of these orders
// answers a question somebody asked while looking at this table.

export type UnmatchedSort =
  | "newest"
  | "oldest"
  | "amountDesc"
  | "amountAsc"
  | "account"
  | "repeats"
  | "branch";

export const UNMATCHED_SORT_OPTIONS: { value: UnmatchedSort; label: string }[] = [
  { value: "newest", label: "วันที่โอน ล่าสุดก่อน (ค่าเริ่มต้น)" },
  { value: "oldest", label: "วันที่โอน เก่าสุดก่อน" },
  { value: "amountDesc", label: "ยอดมาก → น้อย" },
  { value: "amountAsc", label: "ยอดน้อย → มาก" },
  { value: "account", label: "เลขบัญชี" },
  { value: "repeats", label: "บัญชีที่โอนมาหลายครั้งก่อน" },
  { value: "branch", label: "บัญชีที่รับ (สาขา)" },
];

export interface SortableTransfer {
  accountNumber: string;
  amount: number;
  transferredAt: string | null;
  branch: string | null;
}

// A row with no date sorts last whichever way time is running: "unknown" is
// not "the oldest", and putting it at the top of เก่าสุดก่อน would hand staff
// a screenful of rows with nothing to chase in them.
const timeOf = (row: SortableTransfer): number | null => {
  if (!row.transferredAt) return null;
  const at = new Date(row.transferredAt).getTime();
  return Number.isNaN(at) ? null : at;
};

const byTime = (a: SortableTransfer, b: SortableTransfer, newestFirst: boolean): number => {
  const left = timeOf(a);
  const right = timeOf(b);
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return newestFirst ? right - left : left - right;
};

// Sorted without disturbing the rows' own order where the key is equal, so
// that within one account the transfers still read in the order they arrived.
export function sortUnmatched<T extends SortableTransfer>(
  rows: T[],
  sort: UnmatchedSort
): T[] {
  // How many rows each account carries, for the ordering that puts the
  // accounts worth one lookup first. Counted over the list being shown, which
  // is what the person can see and act on.
  const perAccount = new Map<string, number>();
  for (const row of rows) {
    perAccount.set(row.accountNumber, (perAccount.get(row.accountNumber) ?? 0) + 1);
  }

  const sorted = [...rows];
  switch (sort) {
    case "oldest":
      return sorted.sort((a, b) => byTime(a, b, false));
    case "amountDesc":
      return sorted.sort((a, b) => b.amount - a.amount);
    case "amountAsc":
      return sorted.sort((a, b) => a.amount - b.amount);
    case "account":
      return sorted.sort(
        (a, b) => a.accountNumber.localeCompare(b.accountNumber) || byTime(a, b, true)
      );
    case "repeats":
      // The repeated accounts first, and each account's rows together —
      // scattered across the page they are three separate lookups again.
      return sorted.sort(
        (a, b) =>
          (perAccount.get(b.accountNumber) ?? 0) - (perAccount.get(a.accountNumber) ?? 0) ||
          a.accountNumber.localeCompare(b.accountNumber) ||
          byTime(a, b, true)
      );
    case "branch":
      return sorted.sort(
        (a, b) => (a.branch ?? "").localeCompare(b.branch ?? "", "th") || byTime(a, b, true)
      );
    case "newest":
    default:
      return sorted.sort((a, b) => byTime(a, b, true));
  }
}
