import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { STATEMENT_ACCOUNTS } from "@/lib/statementReconcile";
import { removalProblem } from "@/lib/statementUploads";

export const dynamic = "force-dynamic";

// The statement files that are loaded, and the way to take one back out.
//
// Uploading is the one action on this page that cannot be undone by doing it
// again: a file loaded under the wrong account writes a whole second set of
// lines, and every day it covers then counts its money twice. Until now
// nothing listed what had been loaded, so the mistake was neither visible nor
// reversible from the dashboard.
//
// Grouped by account and file name, which is exactly what one upload wrote:
// a line already stored keeps the sourceFile it first arrived with, so the
// pair names a batch rather than a filename that might be shared.
export async function GET() {
  const rows = await prisma.statementLine.groupBy({
    by: ["account", "branch", "sourceFile"],
    _count: { _all: true },
    _min: { postedAt: true },
    _max: { postedAt: true, createdAt: true },
    _sum: { amount: true },
  });

  const uploads = rows
    .map((row) => ({
      account: row.account,
      branch: row.branch,
      sourceFile: row.sourceFile,
      lines: row._count._all,
      from: row._min.postedAt?.toISOString() ?? null,
      to: row._max.postedAt?.toISOString() ?? null,
      amount: Math.round((row._sum.amount ?? 0) * 100) / 100,
      uploadedAt: row._max.createdAt?.toISOString() ?? null,
    }))
    .sort(
      (a, b) =>
        a.account.localeCompare(b.account) ||
        (b.from ?? "").localeCompare(a.from ?? "") ||
        (a.sourceFile ?? "").localeCompare(b.sourceFile ?? "", "th")
    );

  return NextResponse.json({ uploads });
}

// Removing one upload's lines.
//
// Refused while any of those lines has a transaction filed against it: the
// transaction would go on existing, pointing at a bank line that no longer
// does, and the money it records would vanish from every total that reads the
// statement. Deleting the transaction first is a decision about somebody's
// payment, and it belongs on the tab that shows payments.
export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const account = String(body.account ?? "").trim();
  const sourceFile = body.sourceFile === null ? null : String(body.sourceFile ?? "").trim();

  if (!STATEMENT_ACCOUNTS[account]) {
    return NextResponse.json({ error: "ต้องระบุบัญชีของไฟล์ที่จะลบ" }, { status: 400 });
  }

  const where = { account, sourceFile };
  const lines = await prisma.statementLine.findMany({ where, select: { id: true } });
  if (lines.length === 0) {
    return NextResponse.json(
      { error: "ไม่พบไฟล์นี้ในบัญชีที่ระบุ — อาจถูกลบไปแล้ว ลองโหลดหน้านี้ใหม่" },
      { status: 404 }
    );
  }

  const recorded = await prisma.expense.count({
    where: { statementLineId: { in: lines.map((line) => line.id) } },
  });
  const problem = removalProblem(recorded);
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 409 });
  }

  const removed = await prisma.statementLine.deleteMany({ where });
  return NextResponse.json({ account, sourceFile, removed: removed.count });
}
