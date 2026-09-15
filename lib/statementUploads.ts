// Taking an uploaded statement back out.
//
// Every other action on the daily page is either additive or reversible by
// repeating it. An upload is neither: loaded under the wrong account, it
// writes a second set of lines that collides with nothing, and the days it
// covers count their money twice — see lib/statementAccountMixup.ts for the
// slip that causes it.
//
// So removal exists. The one thing it must not do quietly is strand a
// payment.

// One upload, as the dashboard lists it.
export interface StatementUpload {
  account: string;
  branch: string;
  // Null for lines loaded before filenames were recorded.
  sourceFile: string | null;
  lines: number;
  from: string | null;
  to: string | null;
  amount: number;
}

// Why this upload cannot be removed. Null when it can.
//
// A transaction filed from one of these lines points at it by id. Delete the
// line and the transaction survives, pointing at nothing: the daily view
// drops the dangling link, the payment stops appearing against the money it
// paid, and the unique index that stops the same line being recorded twice no
// longer covers it. None of that announces itself.
//
// Refused rather than cascaded, because deleting somebody's recorded payment
// is a different decision from tidying up a bad upload, and should be made
// where payments are shown.
export function removalProblem(recordedCount: number): string | null {
  if (recordedCount > 0) {
    return (
      `ลบไม่ได้ เพราะมี ${recordedCount} รายการที่เจ้าหน้าที่บันทึกไว้จากบรรทัดในไฟล์นี้ — ` +
      'ถ้าจะลบไฟล์ ให้ลบรายการเหล่านั้นที่แท็บ "รายการ" ก่อน'
    );
  }
  return null;
}

// Two uploads of the same days under different accounts: the shape a
// wrong-account upload leaves behind, named so the list can point at it
// instead of leaving staff to spot it.
//
// Compared on the days covered rather than on the file name, because the same
// export saved twice is often renamed, and a statement is what it covers.
export function overlapsAnotherAccount(
  upload: StatementUpload,
  all: StatementUpload[]
): boolean {
  const { from, to } = upload;
  if (!from || !to) return false;
  return all.some(
    (other) =>
      other.account !== upload.account &&
      other.from !== null &&
      other.to !== null &&
      // Any shared day at all. Two accounts genuinely covering the same days
      // is normal; what is not normal is the pair also being the same size,
      // which is what the count here is for.
      other.from <= to &&
      from <= other.to &&
      other.lines === upload.lines
  );
}
