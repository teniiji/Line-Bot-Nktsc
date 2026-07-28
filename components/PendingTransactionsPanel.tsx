"use client";

import { useCallback, useEffect, useState } from "react";
import { formatAmount } from "@/lib/format";
import ConfirmDialog from "@/components/ConfirmDialog";

interface PendingTransactionEntry {
  id: string;
  lineUserId: string;
  displayName: string | null;
  nickname: string | null;
  category: string | null;
  amount: number | null;
  hasSlip: boolean;
  createdAt: string;
  waitingFor: string;
}

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function PendingTransactionsPanel() {
  const [entries, setEntries] = useState<PendingTransactionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<PendingTransactionEntry | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/pending-transactions");
    const body = await res.json();
    setEntries(body.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await fetch(`/api/pending-transactions/${id}`, { method: "DELETE" });
    await fetchEntries();
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow">
        <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="font-semibold">รายการค้าง ({entries.length})</h2>
        <p className="text-xs text-slate-500 mt-1">
          สลิปที่บอทรับแล้วแต่ยังบันทึกไม่สำเร็จ — รอสมาชิกตอบข้อมูลที่ขาดอยู่ ยังไม่ขึ้นในตาราง "ธุรกรรม"
          ด้านล่างจนกว่าจะครบ ถ้าสมาชิกเงียบไปแล้วไม่ตอบ ลบทิ้งได้เลย (ไม่กระทบข้อมูลที่บันทึกสำเร็จแล้ว)
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-slate-100 text-slate-600 text-left">
            <tr>
              <th className="px-4 py-2">สมาชิก</th>
              <th className="px-4 py-2">หมวดหมู่</th>
              <th className="px-4 py-2">ยอดเงิน</th>
              <th className="px-4 py-2">สถานะ</th>
              <th className="px-4 py-2">รับสลิปเมื่อ</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-t border-slate-100">
                <td className="px-4 py-2">
                  {entry.nickname || entry.displayName || (
                    <span className="font-mono text-xs text-slate-500">{entry.lineUserId}</span>
                  )}
                </td>
                <td className="px-4 py-2">{entry.category ?? "—"}</td>
                <td className="px-4 py-2">{entry.amount !== null ? formatAmount(entry.amount) : "—"}</td>
                <td className="px-4 py-2">
                  <span className="inline-block px-2 py-0.5 rounded-full text-xs border bg-amber-50 text-amber-700 border-amber-200">
                    {entry.waitingFor}
                  </span>
                </td>
                <td className="px-4 py-2 whitespace-nowrap text-slate-500">
                  {formatDateTime(entry.createdAt)}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => setPendingDelete(entry)}
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

      <ConfirmDialog
        open={pendingDelete !== null}
        title="ลบรายการค้างนี้?"
        description={
          pendingDelete
            ? `จะลบรายการที่รอ "${pendingDelete.waitingFor}" ของ "${
                pendingDelete.nickname || pendingDelete.displayName || pendingDelete.lineUserId
              }" — ไม่กระทบธุรกรรมที่บันทึกสำเร็จแล้ว ถ้าสมาชิกส่งสลิปมาใหม่จะเริ่มรายการค้างใหม่`
            : undefined
        }
        confirmLabel="ลบ"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
