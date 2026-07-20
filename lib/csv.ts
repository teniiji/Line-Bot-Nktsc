import { Expense } from "./types";

const escapeCsvField = (value: string) =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

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
    "รายละเอียด",
    "จำนวนเงิน",
  ];
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
    e.description ?? "",
    e.amount.toFixed(2),
  ]);

  const csv = [header, ...rows]
    .map((row) => row.map((field) => escapeCsvField(String(field))).join(","))
    .join("\n");

  // BOM so Excel opens the Thai text as UTF-8 instead of mojibake.
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `nktsc-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
