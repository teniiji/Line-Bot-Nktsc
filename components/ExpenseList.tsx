"use client";

import { Expense } from "@/lib/types";
import { formatAmount } from "@/lib/format";

interface ExpenseListProps {
  expenses: Expense[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onEdit: (expense: Expense) => void;
  onDeleteRequest: (expense: Expense) => void;
  onVerifyRequest: (expense: Expense) => void;
  onExportCsv: () => void;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

function memberLabel(expense: Expense): string {
  if (expense.memberFullName) {
    return expense.memberNumber
      ? `${expense.memberFullName} (${expense.memberNumber})`
      : expense.memberFullName;
  }
  const user = expense.user;
  if (user) return user.nickname ?? user.displayName ?? "สมาชิก LINE";
  return "บันทึกโดยเจ้าหน้าที่";
}

export default function ExpenseList({
  expenses,
  total,
  page,
  pageSize,
  onPageChange,
  onEdit,
  onDeleteRequest,
  onVerifyRequest,
  onExportCsv,
}: ExpenseListProps) {
  if (total === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-slate-500">
        ยังไม่มีรายการที่ตรงกับเงื่อนไข
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <p className="text-sm text-slate-500">
          แสดง {start + 1}–{Math.min(start + pageSize, total)} จาก {total} รายการ
        </p>
        <button
          type="button"
          onClick={onExportCsv}
          className="text-sm text-slate-600 border border-slate-300 rounded px-3 py-1.5 hover:bg-slate-50"
        >
          ส่งออก CSV
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="bg-slate-100 text-slate-600 text-left">
            <tr>
              <th className="px-4 py-2">วันที่</th>
              <th className="px-4 py-2">หมวดหมู่</th>
              <th className="px-4 py-2">สมาชิก</th>
              <th className="px-4 py-2">สถานะ</th>
              <th className="px-4 py-2">รายละเอียด</th>
              <th className="px-4 py-2 text-right">จำนวนเงิน</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((expense) => (
              <tr key={expense.id} className="border-t border-slate-100">
                <td className="px-4 py-2 whitespace-nowrap">
                  {formatDate(expense.date)}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {expense.category}
                  {expense.loanType ? (
                    <span className="text-slate-400"> · {expense.loanType}</span>
                  ) : null}
                  {expense.depositAccountNumber ? (
                    <span className="text-slate-400"> · บช. {expense.depositAccountNumber}</span>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {memberLabel(expense)}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {expense.memberVerified ? (
                    <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                      ยืนยันแล้ว
                    </span>
                  ) : (
                    <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                      รอยืนยัน
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-500">
                  {expense.description || "—"}
                </td>
                <td className="px-4 py-2 text-right font-medium whitespace-nowrap">
                  {formatAmount(expense.amount)}
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-right space-x-3">
                  {!expense.memberVerified && expense.memberNumber && (
                    <button
                      onClick={() => onVerifyRequest(expense)}
                      className="text-green-700 hover:underline py-1"
                    >
                      ยืนยันตัวตน
                    </button>
                  )}
                  <button
                    onClick={() => onEdit(expense)}
                    className="text-slate-600 hover:underline py-1"
                  >
                    แก้ไข
                  </button>
                  <button
                    onClick={() => onDeleteRequest(expense)}
                    className="text-red-600 hover:underline py-1"
                  >
                    ลบ
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
          <button
            type="button"
            disabled={page === 1}
            onClick={() => onPageChange(page - 1)}
            className="text-sm px-3 py-1.5 border border-slate-300 rounded disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ก่อนหน้า
          </button>
          <p className="text-sm text-slate-500">
            หน้า {page} / {totalPages}
          </p>
          <button
            type="button"
            disabled={page === totalPages}
            onClick={() => onPageChange(page + 1)}
            className="text-sm px-3 py-1.5 border border-slate-300 rounded disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ถัดไป
          </button>
        </div>
      )}
    </div>
  );
}
