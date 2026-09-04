import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  checkUploadedFile,
  describeReadError,
  readFirstSheetRows,
} from "@/lib/excelUpload";
import {
  parseStatementRows,
  transferFingerprint,
  STATEMENT_ACCOUNTS,
} from "@/lib/statementReconcile";
import {
  applyDirectoryAccounts,
  recomputeRoundPayments,
  rematchRoundTransfers,
} from "@/lib/statementRecompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Takes one bank statement and reconciles it against the round's list.
//
// Which branch a transfer arrived at is not in the statement rows — it is
// which of the cooperative's two accounts the statement belongs to — so the
// account is chosen on upload and recorded against every transfer from this
// file.
//
// Statements accumulate. One account's transfers for a month routinely
// arrive as several exports covering different date ranges, so each upload
// adds the lines this round does not already have. Duplicate protection is
// per statement line (see transferFingerprint) rather than per file, which
// means an unchanged file re-uploaded adds nothing, and two exports whose
// date ranges overlap count the shared days once.
//
// This used to replace the account's whole set on every upload, which meant
// a second file for the same account silently reverted everyone the first
// one had marked as paid back to "ยังค้าง".
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const round = await prisma.statementRound.findUnique({ where: { id: params.id } });
  if (!round) {
    return NextResponse.json({ error: "ไม่พบรอบนี้" }, { status: 404 });
  }

  const form = await request.formData();
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

  const members = await prisma.statementMember.findMany({
    where: { roundId: round.id },
    select: { memberNumber: true, accountNumber: true },
  });
  if (members.length === 0) {
    return NextResponse.json(
      { error: "ยังไม่มีรายชื่อหักไม่ได้ในรอบนี้ — อัปโหลดไฟล์รายชื่อก่อน" },
      { status: 400 }
    );
  }

  let rows: unknown[][];
  try {
    rows = await readFirstSheetRows(checked.file);
  } catch (err) {
    return NextResponse.json({ error: describeReadError(err) }, { status: 400 });
  }

  const transfers = parseStatementRows(rows);
  if (transfers.length === 0) {
    return NextResponse.json(
      { error: 'ไม่พบรายการโอน "TR fr" ในไฟล์นี้ — ตรวจว่าเป็นไฟล์ Statement ที่ถูกต้อง' },
      { status: 400 }
    );
  }

  // skipDuplicates leans on the unique (roundId, fingerprint) index: lines
  // this round already holds — from this same file uploaded again, or from an
  // overlapping date range — are left alone rather than added a second time.
  //
  // Rows go in unmatched and are resolved by rematchRoundTransfers below
  // rather than being matched here: that keeps one implementation of "which
  // member does this account belong to", which now has to consider both the
  // round's sheet and the MemberBankAccount directory.
  const created = await prisma.statementTransfer.createMany({
    data: transfers.map((transfer) => ({
      roundId: round.id,
      accountNumber: transfer.accountNumber,
      amount: transfer.amount,
      transferredAt: transfer.transferredAt,
      account,
      branch,
      description: transfer.description,
      fingerprint: transferFingerprint(account, transfer),
      sourceFile: checked.file.name,
    })),
    skipDuplicates: true,
  });

  await applyDirectoryAccounts(round.id);
  await rematchRoundTransfers(round.id);
  await recomputeRoundPayments(round.id);

  // Counted from what was actually stored, so the numbers describe the round
  // rather than just this file.
  const accountNumbers = [...new Set(transfers.map((t) => t.accountNumber))];
  const stored = await prisma.statementTransfer.findMany({
    where: { roundId: round.id, accountNumber: { in: accountNumbers } },
    select: { memberNumber: true, accountNumber: true },
  });
  const matched = new Set(
    stored.filter((t) => t.memberNumber).map((t) => t.memberNumber as string)
  );
  const unmatched = new Set(
    stored.filter((t) => !t.memberNumber).map((t) => t.accountNumber)
  );

  return NextResponse.json({
    account,
    branch,
    transfers: transfers.length,
    added: created.count,
    duplicates: transfers.length - created.count,
    matched: matched.size,
    unmatched: unmatched.size,
  });
}

// Drops every transfer read from one of the two accounts, leaving the other
// account and the member list alone. The way out of a statement uploaded
// against the wrong account — without it, since uploads now accumulate, those
// rows would have no way out short of deleting the whole round.
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { searchParams } = new URL(request.url);
  const account = String(searchParams.get("account") ?? "").trim();
  if (!STATEMENT_ACCOUNTS[account]) {
    return NextResponse.json({ error: "ต้องระบุบัญชี (413 หรือ 447)" }, { status: 400 });
  }

  const removed = await prisma.statementTransfer.deleteMany({
    where: { roundId: params.id, account },
  });
  await recomputeRoundPayments(params.id);

  return NextResponse.json({ removed: removed.count });
}
