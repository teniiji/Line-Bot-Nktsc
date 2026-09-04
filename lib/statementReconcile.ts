// Pure logic behind the "เทียบ Statement" tab: reading the two kinds of
// sheet staff upload, and deciding what a member's payment status is.
//
// Kept free of Prisma and ExcelJS so the rules that decide whether someone
// has paid can be tested directly — these are the numbers staff chase people
// over, so getting them wrong is expensive.

export interface MaiDaiRow {
  memberNumber: string;
  name: string;
  unitName: string | null;
  note: string | null;
  accountNumber: string | null;
  hCode: string | null;
  amountDue: number;
}

export interface TransferRow {
  accountNumber: string;
  amount: number;
  transferredAt: Date | null;
  description: string;
  // The account's running balance after this line. Not displayed anywhere —
  // it is carried because it is what lets two otherwise identical transfers
  // (same payer, same amount, same day) tell themselves apart.
  balance: number | null;
  // Distinguishes rows identical in every field above, within one file.
  // Assigned in sheet order, so the same rows appearing again in an
  // overlapping export get the same numbers and recognise each other.
  occurrence: number;
}

export type PaymentStatus = "paid" | "overpaid" | "unpaid";

// A bank account number reaches us in whatever shape Excel felt like storing
// it: as a number (so "0431234567" arrives as 431234567), as a float with a
// trailing ".0", or with spaces and dashes staff typed in. The statement
// side always gives plain digits, so both sides are reduced to digits before
// they are compared.
export function normalizeAccountNumber(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value)
    .trim()
    .replace(/\.0+$/, "")
    .replace(/\D/g, "");
  return digits === "" ? null : digits;
}

export function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).trim().replace(/,/g, "");
  if (cleaned === "") return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

// Statement dates come out of the bank's export in Buddhist-era years, and
// sometimes with the separator missing between day and year ("25/062569"
// instead of "25/06/2569"). Both are normalised here rather than at the call
// site, so every date on screen is a real Gregorian date.
//
// The time of day is kept when the export carries one ("31/08/2569 14:32"),
// because two payments from the same account on the same day are told apart
// by it, and because "โอนตอนไหน" is the first thing staff are asked when a
// member disputes a payment. Dates are built in UTC and rendered in UTC, so
// the clock staff read is the clock the bank printed, whatever timezone the
// viewer's device happens to be set to.
export function parseStatementDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const raw = String(value).trim();
  if (!raw) return null;

  // "25/062569" → "25/06/2569"
  const repaired = raw.replace(/^(\d{1,2})[/-](\d{2})(25\d{2})\b/, "$1/$2/$3");

  const match = repaired.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = Number(match[3]);
    if (year >= 2500) year -= 543;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    const time = parseTimeOfDay(repaired.slice(match[0].length));
    const date = new Date(
      Date.UTC(year, month - 1, day, time?.hour ?? 0, time?.minute ?? 0, time?.second ?? 0)
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(repaired);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// The clock reading that may follow a date in the same cell. Anything that
// isn't a plausible time is ignored rather than guessed at — a wrong time on
// a payment record is worse than no time at all.
function parseTimeOfDay(rest: string): { hour: number; minute: number; second: number } | null {
  const match = rest.match(/^[\sT,]*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] ? Number(match[3]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;

  return { hour, minute, second };
}

// Whether a timestamp carries a real time of day. Exact midnight counts as
// "date only": the bank does not post a transfer at 00:00:00, so nothing real
// is lost, and rows imported before times were read keep showing just their
// date instead of a made-up "00:00".
export function hasTimeOfDay(date: Date): boolean {
  return date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0;
}

// The cooperative's own accounts: which branch a transfer landed at is not
// in the statement rows themselves, it is which statement the row came from.
export const STATEMENT_ACCOUNTS: Record<string, string> = {
  "413": "หนองคาย",
  "447": "บึงกาฬ",
};

// "TR fr 0431234567" is how a member's own transfer appears in the
// statement. Anything else on the statement (BSD14 unit transfers, SDTRC
// pension postings, interest, opening balances) is not a member paying off a
// failed deduction and is deliberately ignored here.
export function extractTransferAccount(description: unknown): string | null {
  const text = String(description ?? "");
  const match = text.match(/TR\s+fr\s+(\d+)/i);
  return match ? match[1] : null;
}

const cell = (row: unknown[], index: number): string | null => {
  const value = String(row[index] ?? "").trim();
  return value === "" ? null : value;
};

// Which column carries สังกัด is not the same in every sheet staff generate.
// The 0869 file puts a numeric หน่วยงาน code in F (identical to the H-code in
// J on every row) and the actual name in G, so reading a fixed column put a
// bare "1" in the สังกัด column and pushed the school name into หมายเหตุ.
//
// Rather than trusting a position, take the candidate that actually reads as
// a name: the one where most non-empty values are not just digits.
export function pickUnitNameColumn(
  rows: unknown[][],
  candidates: number[] = [6, 5]
): number | null {
  let best: { index: number; text: number } | null = null;

  for (const index of candidates) {
    let filled = 0;
    let text = 0;
    for (const row of rows) {
      const value = cell(row, index);
      if (!value) continue;
      filled += 1;
      if (!/^[\d.,\s-]+$/.test(value)) text += 1;
    }
    // Half is a deliberately loose bar: a column of names with a few numeric
    // oddities still reads as names, a column of codes never will.
    if (filled > 0 && text > filled / 2 && (!best || text > best.text)) {
      best = { index, text };
    }
  }

  return best?.index ?? null;
}

export interface MaiDaiSheet {
  // Members with something still outstanding — the round's actual list.
  rows: MaiDaiRow[];
  // Rows the sheet has no result for at all: neither ยอดหักได้ nor
  // ยอดหักไม่ได้. Their unit has not reported back yet ("รอผล (ยังไม่มีข้อมูล)"
  // in the sheet's own summary), so they are not people who failed to pay and
  // must not be imported as though they were — but they are money this round
  // does not yet cover, and staff cannot see that anywhere else.
  awaitingMembers: number;
  awaitingAmount: number;
  // Counted by หน่วยคุม (H-code), which is the unit the cooperative's own
  // "สรุปทุกหน่วยงาน" sheet is organised by — counting the school names in
  // these rows instead gives a much larger number that matches nothing staff
  // can check this against.
  awaitingUnits: string[];
}

// Reads the "รวม_ไม่ได้" sheet, which has no header row, so column positions
// are the contract for everything except สังกัด (see pickUnitNameColumn):
//   A เลขสมาชิก · B ชื่อ-สกุล · C ยอดแจ้งหัก · D ยอดหักได้ · E ยอดหักไม่ได้
//   H เลขประชาชน · I เลขบัญชี · J H-code (รหัสหน่วยคุม)
//
// Only rows with a positive ยอดหักไม่ได้ become the round's list; the sheet
// also carries everyone who was deducted in full, and importing those would
// make every summary count meaningless. เลขประชาชน (H) is deliberately not
// read: it is not needed to match a transfer, and there is no reason to copy
// national ID numbers into this database.
export function parseMaiDaiSheet(rows: unknown[][]): MaiDaiSheet {
  const parsed: MaiDaiRow[] = [];
  const unitColumn = pickUnitNameColumn(rows);
  // Whatever is left of the two candidates is a หมายเหตุ column only if it
  // reads as text too — otherwise it is the หน่วยงาน code, which is already
  // in hCode and is noise next to a member's name.
  const noteColumn = unitColumn === 6 ? null : 6;

  const awaitingUnits = new Set<string>();
  let awaitingMembers = 0;
  let awaitingAmount = 0;

  for (const row of rows) {
    const memberNumber = String(row[0] ?? "").trim();
    if (!memberNumber) continue;

    const collected = parseAmount(row[3]);
    const amountDue = parseAmount(row[4]);
    const unitName = unitColumn === null ? null : cell(row, unitColumn);

    // Blank in both result columns is "no result yet" — distinct from a
    // ยอดหักไม่ได้ of 0, which is a unit that reported and collected in full.
    if (collected === null && amountDue === null) {
      awaitingMembers += 1;
      awaitingAmount += parseAmount(row[2]) ?? 0;
      const unitKey = cell(row, 9) ?? unitName;
      if (unitKey) awaitingUnits.add(unitKey);
      continue;
    }

    if (amountDue === null || amountDue <= 0) continue;

    parsed.push({
      memberNumber,
      name: cell(row, 1) ?? "",
      unitName,
      note: noteColumn === null ? null : cell(row, noteColumn),
      accountNumber: normalizeAccountNumber(row[8]),
      hCode: cell(row, 9),
      amountDue,
    });
  }

  return {
    rows: parsed,
    awaitingMembers,
    awaitingAmount: Math.round(awaitingAmount * 100) / 100,
    awaitingUnits: [...awaitingUnits].sort((a, b) => a.localeCompare(b, "th")),
  };
}

// Reads a bank statement sheet. The bank's export puts its own headers a
// dozen rows down, so rather than trusting a fixed start row, every row is
// examined and only those carrying a "TR fr" description are kept —
// header rows and the export's preamble have none.
//   A Date · B Teller Id · C Txn Code · D Description · E Cheque No. · F Amount
export function parseStatementRows(rows: unknown[][]): TransferRow[] {
  const transfers: TransferRow[] = [];
  const seen = new Map<string, number>();

  for (const row of rows) {
    const description = String(row[3] ?? "");
    const accountNumber = extractTransferAccount(description);
    if (!accountNumber) continue;

    const amount = parseAmount(row[5]);
    if (amount === null || amount <= 0) continue;

    const transferredAt = parseStatementDate(row[0]);
    const balance = parseAmount(row[7]);

    // Count identical rows as we go, so the second "same payer, same amount,
    // same day, same balance" line in a file is a different transfer rather
    // than a duplicate of the first.
    const key = identityKey(accountNumber, amount, transferredAt, balance);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);

    transfers.push({
      accountNumber,
      amount,
      transferredAt,
      description: description.trim(),
      balance,
      occurrence,
    });
  }

  return transfers;
}

function identityKey(
  accountNumber: string,
  amount: number,
  transferredAt: Date | null,
  balance: number | null
): string {
  return [
    accountNumber,
    amount.toFixed(2),
    transferredAt ? transferredAt.toISOString().slice(0, 10) : "",
    balance === null ? "" : balance.toFixed(2),
  ].join("|");
}

// What makes one transfer *this* transfer, stable across uploads.
//
// Statements are exported per date range and the ranges overlap as often as
// not (1-15, then 1-30), so the same line legitimately arrives more than
// once and must be recognised rather than counted twice. Everything the bank
// gives us about the line goes into the key, including the running balance,
// which differs even between two payments of the same amount on the same day.
export function transferFingerprint(account: string, transfer: TransferRow): string {
  return [
    account,
    identityKey(transfer.accountNumber, transfer.amount, transfer.transferredAt, transfer.balance),
    transfer.occurrence,
  ].join("|");
}

// The status rule staff already work to: compare what arrived against what
// was owed. A member who paid nothing lands in the same "ยังค้าง" bucket as
// one who paid too little, which is the point — both still owe money.
export function calcPaymentStatus(
  amountPaid: number,
  amountDue: number
): { status: PaymentStatus; diff: number } {
  const diff = Math.round((amountPaid - amountDue) * 100) / 100;
  if (diff === 0) return { status: "paid", diff };
  if (diff > 0) return { status: "overpaid", diff };
  return { status: "unpaid", diff };
}

// Only the three fields matching actually reads, so callers (and tests) need
// not build a whole statement line to ask who a payment belongs to.
export type MatchableTransfer = Pick<
  TransferRow,
  "accountNumber" | "amount" | "transferredAt"
>;

export interface MatchResult<T extends MatchableTransfer = TransferRow> {
  matchedByMember: Map<string, { amountPaid: number; paidAt: Date | null }>;
  unmatched: T[];
}

// Matches a statement's transfers against the round's members by account
// number. Several transfers can belong to one member (paying in
// instalments), so amounts accumulate and the latest transfer date wins —
// that is the date staff would quote when asked "when did they pay".
export function matchTransfers<T extends MatchableTransfer>(
  transfers: T[],
  members: { memberNumber: string; accountNumber: string | null }[]
): MatchResult<T> {
  const memberByAccount = new Map<string, string>();
  for (const member of members) {
    if (member.accountNumber) memberByAccount.set(member.accountNumber, member.memberNumber);
  }

  const matchedByMember = new Map<string, { amountPaid: number; paidAt: Date | null }>();
  const unmatched: T[] = [];

  for (const transfer of transfers) {
    const memberNumber = memberByAccount.get(transfer.accountNumber);
    if (!memberNumber) {
      unmatched.push(transfer);
      continue;
    }

    const existing = matchedByMember.get(memberNumber);
    if (existing) {
      existing.amountPaid += transfer.amount;
      if (
        transfer.transferredAt &&
        (!existing.paidAt || transfer.transferredAt > existing.paidAt)
      ) {
        existing.paidAt = transfer.transferredAt;
      }
    } else {
      matchedByMember.set(memberNumber, {
        amountPaid: transfer.amount,
        paidAt: transfer.transferredAt,
      });
    }
  }

  return { matchedByMember, unmatched };
}
