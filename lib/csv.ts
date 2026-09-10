import { Expense, MemberBankAccountEntry, MemberRosterEntry, StatementMemberRow } from "./types";

const escapeCsvField = (value: string) =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

function downloadCsv(rows: string[][], filename: string) {
  const csv = rows
    .map((row) => row.map((field) => escapeCsvField(String(field))).join(","))
    .join("\n");

  // BOM so Excel opens the Thai text as UTF-8 instead of mojibake.
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadExpensesCsv(expenses: Expense[]) {
  const header = [
    "วันที่",
    "หมวดหมู่",
    "ชื่อสมาชิก",
    "เลขสมาชิก",
    "ยืนยันตัวตน",
    "ประเภทเงินกู้",
    "เลขที่บัญชีที่ฝาก",
    "ชื่อในสลิป",
    "ชื่อในสลิปไม่ตรงกับสมาชิก",
    "แจ้งเจ้าหน้าที่",
    "รายละเอียด",
    "จำนวนเงิน",
  ];
  const forwardStatusLabel: Record<Expense["forwardStatus"], string> = {
    forwarded: "ส่งแล้ว",
    failed: "ส่งไม่สำเร็จ",
    unconfigured: "ยังไม่ตั้งค่าผู้รับ",
    muted: "ปิดแจ้งเตือนไว้",
  };
  const rows = expenses.map((e) => [
    e.date.slice(0, 10),
    e.category,
    e.memberFullName ?? "",
    e.memberNumber ?? "",
    e.memberVerified ? "ยืนยันแล้ว" : "รอยืนยัน",
    e.loanType ?? "",
    e.depositAccountNumber ?? "",
    e.slipSenderName ?? "",
    e.senderNameMismatch ? "ไม่ตรง (สมาชิกยืนยันแล้ว)" : "",
    forwardStatusLabel[e.forwardStatus] ?? "",
    e.description ?? "",
    e.amount.toFixed(2),
  ]);

  downloadCsv(
    [header, ...rows],
    `nktsc-transactions-${new Date().toISOString().slice(0, 10)}.csv`
  );
}

// Exports exactly the rows the \u0E40\u0E17\u0E35\u0E22\u0E1A Statement table is showing, filters and
// all \u2014 the list staff are about to act on (chase a unit's stragglers, hand
// the \u0E22\u0E31\u0E07\u0E04\u0E49\u0E32\u0E07 names to whoever sends the LINE reminders), not the whole round.
export function downloadStatementMembersCsv(
  members: StatementMemberRow[],
  periodLabel: string
) {
  const statusLabel: Record<string, string> = {
    paid: "\u0E0A\u0E33\u0E23\u0E30\u0E04\u0E23\u0E1A",
    overpaid: "\u0E0A\u0E33\u0E23\u0E30\u0E40\u0E01\u0E34\u0E19",
    unpaid: "\u0E22\u0E31\u0E07\u0E04\u0E49\u0E32\u0E07",
  };
  const header = [
    "\u0E40\u0E25\u0E02\u0E2A\u0E21\u0E32\u0E0A\u0E34\u0E01",
    "\u0E0A\u0E37\u0E48\u0E2D-\u0E2A\u0E01\u0E38\u0E25",
    "\u0E2B\u0E19\u0E48\u0E27\u0E22\u0E04\u0E38\u0E21",
    "\u0E2A\u0E31\u0E07\u0E01\u0E31\u0E14",
    "\u0E40\u0E25\u0E02\u0E1A\u0E31\u0E0D\u0E0A\u0E35",
    "\u0E22\u0E2D\u0E14\u0E2B\u0E31\u0E01\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49",
    "\u0E42\u0E2D\u0E19\u0E21\u0E32\u0E41\u0E25\u0E49\u0E27",
    "\u0E04\u0E07\u0E40\u0E2B\u0E25\u0E37\u0E2D",
    "\u0E27\u0E31\u0E19\u0E17\u0E35\u0E48\u0E42\u0E2D\u0E19",
    "\u0E40\u0E27\u0E25\u0E32\u0E17\u0E35\u0E48\u0E42\u0E2D\u0E19",
    "\u0E2A\u0E32\u0E02\u0E32\u0E17\u0E35\u0E48\u0E42\u0E2D\u0E19",
    "\u0E2A\u0E16\u0E32\u0E19\u0E30",
  ];
  const rows = members.map((m) => [
    m.memberNumber,
    m.name,
    m.hCode ?? "",
    m.unitName ?? "",
    m.accountNumber ?? "",
    m.amountDue.toFixed(2),
    m.amountPaid.toFixed(2),
    (Math.round((m.amountDue - m.amountPaid) * 100) / 100).toFixed(2),
    m.paidAt ? m.paidAt.slice(0, 10) : "",
    // Date and time in their own columns rather than one string, so Excel
    // reads both as values and can sort on them. Statement timestamps hold
    // the bank's wall clock in UTC (lib/format.ts), so the ISO string carries
    // the clock reading verbatim; "00:00" means the export gave no time.
    m.paidAt && m.paidAt.slice(11, 16) !== "00:00" ? m.paidAt.slice(11, 16) : "",
    m.paidBranch ?? "",
    statusLabel[m.status] ?? m.status,
  ]);

  // Period in the filename because staff keep several rounds' exports side by
  // side; spaces out for the sake of whatever opens it downstream.
  const safeLabel = periodLabel.replace(/\s+/g, "-");
  downloadCsv([header, ...rows], `nktsc-statement-${safeLabel}.csv`);
}


// The roster as a working list: who is on file, which unit, whether they have
// reached the bot yet, and what they transfer from.
//
// เลขประจำตัวประชาชน is deliberately not a column. The reason the roster was
// unbrowsable in the first place was that nobody should be able to pull every
// member's national ID onto a screen in one go, and a spreadsheet on somebody's
// laptop is a worse version of that screen — it leaves the building. Staff who
// need one member's ID look that member up, which is the job the field is for.
export function downloadMemberRosterCsv(members: MemberRosterEntry[]) {
  const header = [
    "เลขสมาชิก",
    "ชื่อสมาชิก",
    "สังกัด",
    "เบอร์โทร",
    "สถานะ LINE",
    "ชื่อ LINE",
    "มีเลขบัตรประชาชนในระบบ",
    "จำนวนบัญชีที่ผูกไว้",
    "เลขบัญชีที่ผูกไว้",
  ];
  const rows = members.map((m) => [
    m.memberNumber,
    m.memberName,
    m.unitName ?? "",
    m.phone ?? "",
    // Three states, not two: a binding pointing at an account this app has no
    // record of is the one that needs acting on, and a column reading
    // "เชื่อมแล้ว" would hide exactly those rows.
    !m.lineUserId ? "" : m.lineAccountExists ? "เชื่อมแล้ว" : "ผูกค้าง — ไม่พบบัญชี",
    m.lineDisplayName ?? "",
    // Whether one is on file, never the value itself.
    m.nationalId ? "มี" : "",
    String(m.bankAccounts.length),
    // One cell, because a member can have several and a column per account
    // would make the width depend on whoever has the most.
    m.bankAccounts.join(" / "),
  ]);

  downloadCsv(
    [header, ...rows],
    `nktsc-members-${new Date().toISOString().slice(0, 10)}.csv`
  );
}

// The account directory, exactly as the panel is showing it — filters and all,
// since the filtered list is the one staff are about to work through.
export function downloadBankAccountsCsv(entries: MemberBankAccountEntry[]) {
  const header = [
    "เลขบัญชี",
    "เลขสมาชิก",
    "ชื่อสมาชิก",
    "สังกัด",
    "อยู่ในทะเบียนสมาชิก",
    "หมายเหตุ",
    "แก้ไขล่าสุด",
  ];
  const rows = entries.map((e) => [
    e.accountNumber,
    e.memberNumber,
    e.memberName ?? "",
    e.unitName ?? "",
    // The whole point of the column: a binding to a number the roster has
    // never heard of is usually a typo, and it should survive the export.
    e.inRoster ? "อยู่" : "ไม่พบในทะเบียน",
    e.note ?? "",
    e.updatedAt.slice(0, 10),
  ]);

  downloadCsv(
    [header, ...rows],
    `nktsc-bank-accounts-${new Date().toISOString().slice(0, 10)}.csv`
  );
}
