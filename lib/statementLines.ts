// Every line of a bank statement, not just the ones that pay off a failed
// deduction.
//
// lib/statementReconcile.ts reads the same file but keeps only "TR fr" lines,
// which is right for a round: those are members transferring in from their own
// account, and nothing else on the statement settles a หักไม่ได้. But it means
// most of the file is thrown away — in the August 16-31 export for 413, 758
// lines of 1,203. The 445 dropped include 143 counter deposits worth ฿2.35M,
// which are members paying in too; they just walked into a branch instead of
// using the app.
//
// Reconciling a day's money against the slips members sent through the bot
// needs all of it, so this reads the whole sheet and says what each line is.

import { parseAmount, parseStatementDate } from "./statementReconcile";

export interface StatementLineRow {
  postedAt: Date | null;
  txnCode: string;
  description: string;
  amount: number;
  balance: number | null;
  // The account the money came from, when the line names one. Only read where
  // the format says what the number means; a reference number that merely
  // looks like an account is left alone rather than guessed at.
  senderAccount: string | null;
  channel: string;
  // Separates lines identical in every field above within one file.
  occurrence: number;
}

// How the money reached the cooperative, derived from the bank's transaction
// code. The codes are the ones the cooperative's own statements actually use —
// read off the real exports rather than a spec — so a code nobody has seen
// before lands in "other" and shows up in the tab's own "รายการอื่น" section.
// Silently deciding an unknown code is a member's payment would be worse: it
// would put institutional money into a member reconciliation.
const MEMBER_CHANNELS: Record<string, string> = {
  NBSDT: "transfer", // โอนผ่านแอป/อินเทอร์เน็ตแบงก์กิ้ง — "TR fr <เลขบัญชี>"
  IORSDT: "counter", // ฝากผ่านเคาน์เตอร์สาขา
  ATSDT: "atm",
  ATSDC: "atm",
  MORPSD: "mobile",
  PTSDT: "ewallet", // "TR from EWALLETID ..."
  SDCH: "cheque",
};

export const OTHER_CHANNEL = "other";

// Labels for the dashboard, kept beside the codes they describe so the two
// cannot drift apart.
export const CHANNEL_LABELS: Record<string, string> = {
  transfer: "โอนผ่านแอป",
  counter: "ฝากที่เคาน์เตอร์",
  atm: "ฝากผ่าน ATM",
  mobile: "โอนผ่านมือถือ",
  ewallet: "e-Wallet",
  cheque: "เช็ค",
  [OTHER_CHANNEL]: "อื่นๆ",
};

export function classifyChannel(txnCode: string, amount: number): string {
  // Money leaving the account is never a member paying in, whatever the code
  // says — fees and outward transfers share codes with nothing else here but
  // the sign is the reliable part.
  if (amount <= 0) return OTHER_CHANNEL;
  return MEMBER_CHANNELS[txnCode.toUpperCase()] ?? OTHER_CHANNEL;
}

export function isMemberDeposit(channel: string): boolean {
  return channel !== OTHER_CHANNEL;
}

// Pulls the paying account out of a description whose format states what the
// number is. "TR fr 4131572885" is the member's own account; the branch-code
// forms ("004-2248282765") carry the depositing account after the dash.
export function extractSenderAccount(description: string): string | null {
  const transfer = description.match(/TR\s+fr\s+(\d{6,})/i);
  if (transfer) return transfer[1];

  // "004-2248282765", and the same with the bank's own trailing note
  // ("014-8872614889 Future Amount: 1500 Tran") — the account is still the
  // run of digits after the leading code, so the note must not hide it.
  //
  // A three-digit prefix is the paying bank's national interbank code (004 is
  // กสิกรไทย, 014 ไทยพาณิชย์, 025 กรุงศรีอยุธยา); see lib/thaiBanks.ts, which
  // names it on screen. Longer prefixes appear too and are not bank codes,
  // which is why nothing here depends on the length.
  const viaBranch = description.match(/^[A-Z]?\d{3,6}-(\d{9,})(?!\d)/);
  if (viaBranch) return viaBranch[1];

  return null;
}

const text = (value: unknown): string => String(value ?? "").trim();

// Reads the sheet the bank exports: a four-row account header, a blank row, a
// column header row, then the lines. Rather than trusting those positions, a
// row counts as a line when it has both a readable date and an amount —
// the header rows have neither.
//   A Date · B Teller Id · C Txn Code · D Description · E Cheque No. ·
//   F Amount · G Tax · H Balance · I Init Br
export function parseStatementLines(rows: unknown[][]): StatementLineRow[] {
  const lines: StatementLineRow[] = [];
  const seen = new Map<string, number>();

  for (const row of rows) {
    const postedAt = parseStatementDate(row[0]);
    if (!postedAt) continue;

    const amount = parseAmount(row[5]);
    if (amount === null) continue;

    const txnCode = text(row[2]);
    const description = text(row[3]);
    const balance = parseAmount(row[7]);
    const channel = classifyChannel(txnCode, amount);

    const key = lineKey(postedAt, txnCode, amount, balance);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);

    lines.push({
      postedAt,
      txnCode,
      description,
      amount,
      balance,
      senderAccount: isMemberDeposit(channel) ? extractSenderAccount(description) : null,
      channel,
      occurrence,
    });
  }

  return lines;
}

function lineKey(
  postedAt: Date,
  txnCode: string,
  amount: number,
  balance: number | null
): string {
  return [
    postedAt.toISOString(),
    txnCode,
    amount.toFixed(2),
    balance === null ? "" : balance.toFixed(2),
  ].join("|");
}

// What makes a statement line itself, stable across uploads of overlapping
// date ranges. Unlike transferFingerprint this carries the full timestamp:
// these rows are new, so there is no earlier data at day resolution to stay
// compatible with, and the clock reading tells apart two lines that a date
// alone would merge.
export function statementLineFingerprint(account: string, line: StatementLineRow): string {
  return [
    account,
    line.postedAt ? lineKey(line.postedAt, line.txnCode, line.amount, line.balance) : "",
    line.occurrence,
  ].join("|");
}
