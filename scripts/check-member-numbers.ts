// Read-only: is every member number in the database written the one way, and
// is anybody still marked unverified who the roster actually knows?
//
// Two things this answers that nothing else can.
//
// Did the 20260908070000 backfill actually run? A migration recorded as
// applied whose SQL did not run looks exactly like success — "Database schema
// is up to date!" — while the data sits unchanged. The only honest check is to
// go and look at the rows.
//
// And did every write path get fixed? The canonical form is written at eleven
// places: two sheet parsers, the LINE bot, five dashboard routes and two
// import scripts. "I changed all of them" is a claim; a count of zero is
// evidence. Run this again after a roster import or a หักไม่ได้ upload and a
// non-zero count names the path that was missed.
//
// Touches nothing.
//
// Usage: npx tsx scripts/check-member-numbers.ts

import { memberNumberKey } from "../lib/memberNumber";
import { scriptPrisma } from "./prismaClient";

const prisma = scriptPrisma(
  "memberRoster",
  "statementMember",
  "memberBankAccount",
  "expense",
  "lineUser",
  "serviceRequestLog",
  "statementTransfer"
);

const odd = (rows: { memberNumber: string | null }[]) =>
  rows.filter((row) => row.memberNumber !== null && row.memberNumber !== memberNumberKey(row.memberNumber));

async function main() {
  const [roster, members, accounts, expenses, lineUsers, requests, transfers] = await Promise.all([
    prisma.memberRoster.findMany({ select: { memberNumber: true } }),
    prisma.statementMember.findMany({ select: { memberNumber: true } }),
    prisma.memberBankAccount.findMany({ select: { memberNumber: true } }),
    prisma.expense.findMany({ select: { memberNumber: true } }),
    prisma.lineUser.findMany({ select: { memberNumber: true } }),
    prisma.serviceRequestLog.findMany({ select: { memberNumber: true } }),
    prisma.statementTransfer.findMany({ select: { memberNumber: true } }),
  ]);

  const tables: [string, { memberNumber: string | null }[]][] = [
    ["MemberRoster", roster],
    ["StatementMember", members],
    ["MemberBankAccount", accounts],
    ["Expense", expenses],
    ["LineUser", lineUsers],
    ["ServiceRequestLog", requests],
    ["StatementTransfer", transfers],
  ];

  console.log("1) เลขสมาชิกที่ยังไม่ได้อยู่ในรูปแบบมาตรฐาน");
  console.log("=".repeat(70));
  let oddTotal = 0;
  for (const [name, rows] of tables) {
    const wrong = odd(rows);
    oddTotal += wrong.length;
    const shown = [...new Set(wrong.map((r) => r.memberNumber))].slice(0, 8).join(", ");
    console.log(
      `  ${name.padEnd(20)} ${String(rows.length).padStart(7)} แถว · ผิดรูปแบบ ${wrong.length}` +
        (shown ? `  → ${shown}` : "")
    );
  }
  console.log(
    oddTotal === 0
      ? "\n  ✅ ทุกตารางเป็นรูปแบบเดียวกันหมด — backfill ทำงานแล้ว และไม่มีทางเข้าไหนเขียนรูปแบบเก่ากลับมา\n"
      : `\n  ⛔ รวม ${oddTotal} แถว — มีทางเข้าข้อมูลที่ยังไม่ได้แก้ หรือ backfill ไม่ได้รัน\n`
  );

  // The visible cost of the old spelling: a real member's transactions filed
  // as unverified because the roster was asked about a spelling. After the
  // backfill this should be empty; anything left is a member number the
  // roster genuinely does not have, which is a different problem.
  console.log("2) รายการที่ยัง 'ยังไม่ยืนยันตัวตน' ทั้งที่ทะเบียนสมาชิกรู้จักเลขนี้");
  console.log("=".repeat(70));
  const known = new Set(roster.map((r) => r.memberNumber));
  const unverified = await prisma.expense.findMany({
    where: { memberVerified: false, memberNumber: { not: null } },
    select: { id: true, date: true, amount: true, memberNumber: true, memberFullName: true },
    orderBy: { date: "desc" },
  });
  const fixable = unverified.filter((e) => e.memberNumber && known.has(e.memberNumber));
  if (fixable.length === 0) {
    console.log("  ✅ ไม่มี");
  } else {
    for (const e of fixable.slice(0, 30)) {
      console.log(
        `  ${e.date.toISOString().slice(0, 10)}  ${e.amount.toString().padStart(10)}  ` +
          `${e.memberNumber}  ${e.memberFullName ?? ""}`
      );
    }
    console.log(`\n  รวม ${fixable.length} รายการ — เลขตรงกับทะเบียนแล้วแต่ยังไม่ถูกตั้งเป็นยืนยัน`);
  }

  const stillUnknown = unverified.length - fixable.length;
  console.log(
    `\nหมายเหตุ: ยังมีอีก ${stillUnknown} รายการที่ไม่ยืนยัน เพราะทะเบียนไม่มีเลขสมาชิกนั้นจริงๆ — ` +
      "คนละเรื่องกัน (เลขพิมพ์ผิด หรือทะเบียนยังไม่ได้นำเข้า)"
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
