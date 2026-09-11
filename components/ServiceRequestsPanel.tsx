"use client";

import { useCallback, useEffect, useState } from "react";
import { ServiceRequestLogEntry } from "@/lib/types";
import ConfirmDialog from "@/components/ConfirmDialog";

const PAGE_SIZE = 20;

// Each label carries its own mark, so the four statuses stay four different
// things on a washed-out screen, or to somebody who does not separate the red
// from the green. The colours stay; they are just no longer the only thing
// saying which is which.
const STATUS_LABELS: Record<ServiceRequestLogEntry["status"], string> = {
  forwarded: "✅ ส่งต่อสำเร็จ",
  failed: "❌ ส่งต่อไม่สำเร็จ",
  unconfigured: "⚠️ ยังไม่ตั้งค่าผู้รับ",
  muted: "🔕 ปิดแจ้งเตือนแผนกนี้ไว้",
};

const STATUS_STYLES: Record<ServiceRequestLogEntry["status"], string> = {
  forwarded: "bg-green-50 text-green-700 border-green-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  unconfigured: "bg-amber-50 text-amber-700 border-amber-200",
  muted: "bg-slate-100 text-slate-600 border-slate-200",
};

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function ServiceRequestsPanel() {
  const [entries, setEntries] = useState<ServiceRequestLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingAdd, setPendingAdd] = useState<ServiceRequestLogEntry | null>(null);
  const [adding, setAdding] = useState(false);
  // Sending a request to the officer again — see
  // app/api/service-requests/[id]/resend/route.ts for why the causes of a
  // failed forward are all things staff can put right.
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [resendNotice, setResendNotice] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (status) params.set("status", status);
    const res = await fetch(`/api/service-requests?${params.toString()}`);
    const data = await res.json();
    setEntries(data.data);
    setTotal(data.total);
    setLoading(false);
  }, [page, status]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  useEffect(() => {
    setPage(1);
  }, [status]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleConfirmAdd = async () => {
    if (!pendingAdd) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/service-requests/${pendingAdd.id}/add-to-roster`, {
        method: "POST",
      });
      if (res.ok) {
        setPendingAdd(null);
        await fetchEntries();
      }
    } finally {
      setAdding(false);
    }
  };

  const handleResend = async (entry: ServiceRequestLogEntry) => {
    setResendingId(entry.id);
    setResendError(null);
    setResendNotice(null);
    try {
      const res = await fetch(`/api/service-requests/${entry.id}/resend`, { method: "POST" });
      const body = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) {
        // The reason is the whole value of the button: every cause has a
        // different next step, and "ส่งซ้ำไม่สำเร็จ" on its own is a dead end.
        setResendError(typeof body.error === "string" ? body.error : "ส่งซ้ำไม่สำเร็จ");
        await fetchEntries();
        return;
      }
      setResendNotice(
        `ส่งซ้ำถึงเจ้าหน้าที่แล้ว (${entry.memberFullName ?? "ไม่ทราบชื่อ"}${
          entry.requestType ? ` — ${entry.requestType}` : ""
        })`
      );
      await fetchEntries();
    } finally {
      setResendingId(null);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <h2 className="font-semibold">ทะเบียนคำขอบริการ (ส่งต่อถึงเจ้าหน้าที่)</h2>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="text-sm border border-slate-300 rounded px-2 py-1.5"
        >
          <option value="">ทุกสถานะ</option>
          <option value="forwarded">ส่งต่อสำเร็จ</option>
          <option value="failed">ส่งต่อไม่สำเร็จ</option>
          <option value="unconfigured">ยังไม่ตั้งค่าผู้รับ</option>
          <option value="muted">ปิดแจ้งเตือนแผนกนี้ไว้</option>
        </select>
      </div>

      {resendNotice && (
        <p className="px-4 py-2 text-sm text-green-700 bg-green-50">{resendNotice}</p>
      )}
      {resendError && <p className="px-4 py-2 text-sm text-red-700 bg-red-50">{resendError}</p>}

      {loading ? (
        <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
      ) : entries.length === 0 ? (
        <p className="text-slate-500 text-sm py-8 text-center">
          ยังไม่มีคำขอบริการ — รายการจะแสดงที่นี่เมื่อสมาชิกส่งเอกสารประกอบผ่านบอท
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[920px]">
            <thead className="bg-slate-100 text-slate-600 text-left">
              <tr>
                <th className="px-4 py-2">วันที่-เวลา</th>
                <th className="px-4 py-2">สมาชิก</th>
                <th className="px-4 py-2">เอกสาร</th>
                <th className="px-4 py-2">คำขอ</th>
                <th className="px-4 py-2">แผนก</th>
                <th className="px-4 py-2">เบอร์ติดต่อ</th>
                <th className="px-4 py-2">สถานะ</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 whitespace-nowrap text-slate-500">
                    {formatDateTime(entry.createdAt)}
                  </td>
                  <td className="px-4 py-2">
                    {entry.memberFullName ?? "—"}
                    {entry.memberNumber ? (
                      <span className="text-slate-400"> ({entry.memberNumber})</span>
                    ) : null}
                    {!entry.memberVerified && (
                      <span className="ml-1 text-xs text-amber-600">⚠️ ยังไม่ยืนยัน</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {entry.imageUrl ? (
                      <a
                        href={entry.imageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {entry.documentType}
                      </a>
                    ) : (
                      entry.documentType
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {entry.requestType ?? "—"}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {entry.department ?? "—"}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-slate-500">
                    {entry.phone ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-block text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLES[entry.status]}`}
                    >
                      {STATUS_LABELS[entry.status]}
                    </span>
                    {/* The reason, when LINE gave one — see lib/pushError.ts.
                        Shown rather than hidden in a tooltip: "ส่งต่อไม่สำเร็จ"
                        on its own is a dead end, and the next step is
                        different for every cause. */}
                    {entry.forwardError && (
                      <p className="text-xs text-red-700 mt-1 max-w-xs">{entry.forwardError}</p>
                    )}
                    {/* A row that now reads "ส่งต่อสำเร็จ" still says when the
                        member asked; this says when it actually reached the
                        officer, which on a resent request is not the same day. */}
                    {entry.resentAt && (
                      <p className="text-xs text-slate-400 mt-1">
                        ส่งซ้ำเมื่อ {formatDateTime(entry.resentAt)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-3">
                      {entry.status !== "forwarded" && (
                        <button
                          onClick={() => handleResend(entry)}
                          disabled={resendingId !== null}
                          className="text-blue-600 hover:underline py-1 disabled:opacity-50"
                        >
                          {resendingId === entry.id ? "กำลังส่ง…" : "ส่งซ้ำ"}
                        </button>
                      )}
                      {!entry.memberVerified && entry.memberNumber && entry.memberFullName && (
                        <button
                          onClick={() => setPendingAdd(entry)}
                          className="text-green-700 hover:underline py-1"
                        >
                          เพิ่มเข้าทะเบียน
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
          <button
            type="button"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
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
            onClick={() => setPage(page + 1)}
            className="text-sm px-3 py-1.5 border border-slate-300 rounded disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ถัดไป
          </button>
        </div>
      )}

      <ConfirmDialog
        open={pendingAdd !== null}
        title="เพิ่มสมาชิกเข้าทะเบียน?"
        description={
          pendingAdd
            ? `เพิ่ม ${pendingAdd.memberFullName} (เลขสมาชิก ${pendingAdd.memberNumber}) เข้า MemberRoster โดยใช้ข้อมูลที่สมาชิกแจ้งผ่านแชท — แนะนำให้ยืนยันตัวตนทางโทรศัพท์ก่อน (เบอร์ ${pendingAdd.phone ?? "-"}) คำขอ/ธุรกรรมอื่นของเลขสมาชิกนี้จะถูกยืนยันให้ด้วย`
            : undefined
        }
        confirmLabel={adding ? "กำลังเพิ่ม…" : "เพิ่มเข้าทะเบียน"}
        onConfirm={handleConfirmAdd}
        onCancel={() => setPendingAdd(null)}
      />
    </div>
  );
}
