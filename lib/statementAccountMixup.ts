// Catching a statement uploaded under the wrong account.
//
// The account a statement belongs to is not in the rows — it is which of the
// cooperative's two accounts the export was taken from — so it is chosen from
// a dropdown at upload time. The dropdown remembers the last choice, and the
// two files look alike, so uploading 413's statement with 447 still selected
// is a slip anyone makes in a hurry.
//
// Nothing caught it. The stored line is keyed by account and fingerprint, so
// the same file under a second account is a second set of rows that collides
// with nothing: every line of the day then exists twice, once per account,
// and the day's money-in counts each payment twice. On screen it is two
// identical rows — same time, same amount, same payer — differing only in
// which account they say the money reached.
//
// The file itself can say which it is, because the running balance is on
// every line. Two accounts cannot post the same amount at the same second and
// arrive at the same balance, so a line already stored under another account
// with the same identity is not a coincidence: it is this file, already
// loaded, under the account somebody meant to pick.

import { prisma } from "./prisma";
import { STATEMENT_ACCOUNTS } from "./statementReconcile";
import { parseStatementLines, statementLineIdentity } from "./statementLines";

// How much of a file has to be already stored elsewhere before it is treated
// as the wrong account rather than as a coincidence.
//
// The real cases are not near this line. A correct upload overlaps another
// account by nothing at all; the wrong account overlaps it by everything. The
// threshold exists so that a handful of lines cannot block an upload — a
// statement genuinely covering a new range should load even if something odd
// has happened to a few rows.
export const MIXUP_SHARE = 0.5;

export interface AccountOverlap {
  account: string;
  branch: string;
  // Lines of the file being uploaded that are already stored under that
  // account.
  lines: number;
}

// The account this file appears to have been uploaded under already, or null
// when nothing suggests one.
export function mixedUpWith(
  fileLines: number,
  overlaps: AccountOverlap[]
): AccountOverlap | null {
  if (fileLines <= 0) return null;
  const worst = overlaps.reduce<AccountOverlap | null>(
    (best, o) => (best === null || o.lines > best.lines ? o : best),
    null
  );
  if (!worst || worst.lines / fileLines < MIXUP_SHARE) return null;
  return worst;
}

// Said instead of loading it. Names both accounts, because the fix is to pick
// the other one — and says what to do about the copy already stored, since
// the upload that caused this was very likely the one before this.
export function mixupError(
  chosen: { account: string; branch: string },
  already: AccountOverlap,
  fileLines: number
): string {
  return (
    `ไฟล์นี้ดูเหมือนเป็น Statement ของบัญชี ${already.account} ${already.branch} ` +
    `ไม่ใช่ ${chosen.account} ${chosen.branch} — ` +
    `${already.lines} จาก ${fileLines} บรรทัดในไฟล์ มีอยู่ในบัญชี ${already.account} แล้ว ` +
    "(ยอดคงเหลือกับเวลาตรงกันทุกตัว จึงเป็นไฟล์เดียวกันแน่นอน)\n" +
    `• ถ้าจะอัปไฟล์นี้ ให้เลือกบัญชี ${already.account} ${already.branch} แล้วอัปใหม่ — ` +
    "ระบบจะไม่นับเงินซ้ำ\n" +
    "• ถ้าเคยอัปผิดบัญชีไปแล้ว ลบไฟล์ที่อัปผิดได้ที่รายการ \"ไฟล์ Statement ที่อัปไว้\" ใต้ช่องอัปโหลด"
  );
}

export interface AccountMixup {
  overlap: AccountOverlap;
  // How many lines the uploaded file itself carries — mixupError's own
  // "X จาก Y บรรทัด" needs it, and it is this function that already parsed
  // the file to get it, so callers do not have to parse it a second time.
  fileLines: number;
}

// The check itself, shared by every upload path: reads the file's own lines
// (the same identity StatementLine stores them under), asks StatementLine
// which of the *other* accounts already has each one, and hands the count to
// mixedUpWith above. One implementation so a route added later inherits the
// guard automatically instead of needing its own copy remembered.
export async function findAccountMixup(
  rows: unknown[][],
  account: string
): Promise<AccountMixup | null> {
  const parsedLines = parseStatementLines(rows);
  const others = Object.keys(STATEMENT_ACCOUNTS).filter((a) => a !== account);
  if (parsedLines.length === 0 || others.length === 0) return null;

  const identities = parsedLines.map(statementLineIdentity);
  const elsewhere = await prisma.statementLine.findMany({
    where: {
      account: { in: others },
      fingerprint: {
        in: others.flatMap((a) => identities.map((id) => `${a}|${id}`)),
      },
    },
    select: { account: true },
  });

  const byAccount = new Map<string, number>();
  for (const row of elsewhere) {
    byAccount.set(row.account, (byAccount.get(row.account) ?? 0) + 1);
  }
  const overlap = mixedUpWith(
    parsedLines.length,
    [...byAccount].map(([a, lines]) => ({
      account: a,
      branch: STATEMENT_ACCOUNTS[a] ?? a,
      lines,
    }))
  );
  return overlap ? { overlap, fileLines: parsedLines.length } : null;
}
