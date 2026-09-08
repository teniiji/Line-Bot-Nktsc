import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkUploadedFile, describeReadError, readFirstSheetRows } from "@/lib/excelUpload";
import { STATEMENT_ACCOUNTS } from "@/lib/statementReconcile";
import { storeStatementLines } from "@/lib/statementLineStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Uploading a bank statement for the daily view, with no round involved.
//
// Checking a day's money against the slips members sent has nothing to do
// with the month-end หักไม่ได้ round — it is the everyday question "did what
// arrived today match what people told us they sent". But the only route that
// wrote StatementLine was the round's, which additionally refuses unless that
// round already has a member list uploaded. So looking at one ordinary day
// meant creating a round and importing a หักไม่ได้ sheet first, neither of
// which has anything to do with the question being asked.
//
// The data was never the problem: StatementLine carries no roundId at all. It
// is keyed by account and line fingerprint precisely so a line belongs to the
// cooperative's account rather than to any round. Only the way in was
// round-shaped. This is the way in that is not.
//
// The round's own upload still stores lines exactly as before. Both paths
// write the same fingerprints, so the same file through either one refreshes
// the same rows rather than doubling them.
export async function POST(request: NextRequest) {
  const form = await request.formData();

  // Which branch a line arrived at is not in the rows — it is which of the
  // cooperative's two accounts the statement belongs to — so it is chosen on
  // upload, the same as on the round's path.
  const account = String(form.get("account") ?? "").trim();
  const branch = STATEMENT_ACCOUNTS[account];
  if (!branch) {
    return NextResponse.json(
      { error: "ต้องเลือกบัญชีที่ไฟล์นี้เป็นของ (413 หนองคาย หรือ 447 บึงกาฬ)" },
      { status: 400 }
    );
  }

  const checked = checkUploadedFile(form.get("file"));
  if ("error" in checked) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }

  let rows: unknown[][];
  try {
    rows = await readFirstSheetRows(checked.file);
  } catch (err) {
    return NextResponse.json({ error: describeReadError(err) }, { status: 400 });
  }

  const stored = await storeStatementLines(rows, account, branch, checked.file.name);
  if (stored === 0) {
    return NextResponse.json(
      {
        error:
          "อ่านไฟล์ได้แต่ไม่พบรายการเดินบัญชีเลย — ตรวจว่าเป็นไฟล์ Statement ของธนาคาร " +
          "(มีคอลัมน์ Date / Transaction Code / Amount) ไม่ใช่ไฟล์รายชื่อ",
      },
      { status: 400 }
    );
  }

  // Which days this upload actually covers, so staff can see straight away
  // whether the day they came here to look at is now available — the whole
  // reason they uploaded. Read back from the account's stored lines rather
  // than from the file, so an export whose range overlaps one already loaded
  // reports what is really there.
  const range = await prisma.statementLine.aggregate({
    where: { account, sourceFile: checked.file.name },
    _min: { postedAt: true },
    _max: { postedAt: true },
  });

  return NextResponse.json({
    account,
    branch,
    lines: stored,
    from: range._min.postedAt?.toISOString() ?? null,
    to: range._max.postedAt?.toISOString() ?? null,
  });
}
