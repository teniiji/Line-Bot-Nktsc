import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  checkUploadedFile,
  readFirstSheetRows,
  UNREADABLE_FILE_ERROR,
} from "@/lib/excelUpload";
import { matchTransfers, parseStatementRows, STATEMENT_ACCOUNTS } from "@/lib/statementReconcile";
import { recomputeRoundPayments } from "@/lib/statementRecompute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Takes one bank statement and reconciles it against the round's list.
//
// Which branch a transfer arrived at is not in the statement rows — it is
// which of the cooperative's two accounts the statement belongs to — so the
// account is chosen on upload and recorded against every transfer from this
// file. Re-uploading the same account's statement replaces that account's
// transfers rather than adding to them, so a corrected or extended export
// can be dropped in as many times as needed without inflating anyone's
// total; the other account's transfers are left untouched.
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
  } catch {
    return NextResponse.json({ error: UNREADABLE_FILE_ERROR }, { status: 400 });
  }

  const transfers = parseStatementRows(rows);
  if (transfers.length === 0) {
    return NextResponse.json(
      { error: 'ไม่พบรายการโอน "TR fr" ในไฟล์นี้ — ตรวจว่าเป็นไฟล์ Statement ที่ถูกต้อง' },
      { status: 400 }
    );
  }

  const { matchedByMember, unmatched } = matchTransfers(transfers, members);
  const memberByAccount = new Map(
    members
      .filter((m) => m.accountNumber)
      .map((m) => [m.accountNumber as string, m.memberNumber])
  );

  await prisma.$transaction([
    prisma.statementTransfer.deleteMany({ where: { roundId: round.id, account } }),
    prisma.statementTransfer.createMany({
      data: transfers.map((transfer) => ({
        roundId: round.id,
        memberNumber: memberByAccount.get(transfer.accountNumber) ?? null,
        accountNumber: transfer.accountNumber,
        amount: transfer.amount,
        transferredAt: transfer.transferredAt,
        account,
        branch,
        description: transfer.description,
      })),
    }),
  ]);

  await recomputeRoundPayments(round.id);

  return NextResponse.json({
    account,
    branch,
    transfers: transfers.length,
    matched: matchedByMember.size,
    unmatched: unmatched.length,
  });
}
