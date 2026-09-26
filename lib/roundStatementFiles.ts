// The statement files a หักไม่ได้ round was built from, one row per file, so
// a single file loaded by mistake can be taken back out without clearing the
// whole account.
//
// Rows that came in from the เงินเข้าประจำวัน page ("line:" — see the record
// route) carry the daily file's name too, but were never uploaded into the
// round; they are listed apart and not removed with a file. They leave the
// round when their recording is deleted on that page.

export interface FileTransfer {
  id: string;
  account: string;
  branch: string | null;
  sourceFile: string | null;
  fingerprint: string;
  amount: number;
  transferredAt: Date | string | null;
}

export interface RoundStatementFile {
  account: string;
  branch: string;
  sourceFile: string | null;
  bridged: boolean;
  // Bank lines, not rows: a split or set-aside piece is part of the line it
  // was cut from.
  transfers: number;
  amount: number;
  from: string | null;
  to: string | null;
}

export const isBridgedFingerprint = (fingerprint: string) => fingerprint.startsWith("line:");
// Split and set-aside pieces are named "<parent>::split:…" / "<parent>::aside:…".
const isPiece = (fingerprint: string) => fingerprint.includes("::");

const dayOf = (value: Date | string | null): string | null => {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

export function summarizeStatementFiles(transfers: FileTransfer[]): RoundStatementFile[] {
  const files = new Map<string, RoundStatementFile>();
  for (const t of transfers) {
    // Cash was never a file.
    if (t.account === "cash") continue;
    const bridged = isBridgedFingerprint(t.fingerprint);
    const key = JSON.stringify([t.account, t.sourceFile, bridged]);
    const file =
      files.get(key) ??
      ({
        account: t.account,
        branch: t.branch ?? "",
        sourceFile: t.sourceFile,
        bridged,
        transfers: 0,
        amount: 0,
        from: null,
        to: null,
      } satisfies RoundStatementFile);
    if (!isPiece(t.fingerprint)) file.transfers += 1;
    file.amount = Math.round((file.amount + t.amount) * 100) / 100;
    const day = dayOf(t.transferredAt);
    if (day) {
      if (!file.from || day < file.from) file.from = day;
      if (!file.to || day > file.to) file.to = day;
    }
    files.set(key, file);
  }
  return [...files.values()].sort(
    (a, b) =>
      a.account.localeCompare(b.account) ||
      Number(a.bridged) - Number(b.bridged) ||
      (b.to ?? "").localeCompare(a.to ?? "") ||
      (b.sourceFile ?? "").localeCompare(a.sourceFile ?? "", "th")
  );
}

// The rows removing one file takes with it: the file's own lines and any
// piece cut from them, never a row bridged in from the daily page.
export function rowsOfFile<T extends FileTransfer>(
  transfers: T[],
  account: string,
  sourceFile: string | null
): T[] {
  return transfers.filter(
    (t) =>
      t.account === account &&
      (t.sourceFile ?? null) === sourceFile &&
      !isBridgedFingerprint(t.fingerprint)
  );
}

// Why these rows cannot be removed yet. Money already moved onto an earlier
// month's debt (ชำระข้ามเดือน) finds its bank line by fingerprint, and a
// set-aside piece has a transaction filed against it; deleting the row under
// either would leave that pointing at nothing.
export function fileRemovalProblem(counts: { carried: number; setAside: number }): string | null {
  if (counts.carried > 0) {
    return (
      `ลบไม่ได้ — มี ${counts.carried} รายการในไฟล์นี้ที่ย้ายไปชำระข้ามเดือนแล้ว ` +
      `ต้องลบรายการชำระเหล่านั้นที่แถบ "ชำระข้ามเดือน" ก่อน`
    );
  }
  if (counts.setAside > 0) {
    return (
      `ลบไม่ได้ — มี ${counts.setAside} รายการในไฟล์นี้ที่ตัดยอดออกไว้ (✂️) ` +
      `กด "รวมกลับ" ที่รายการนั้นก่อน`
    );
  }
  return null;
}
