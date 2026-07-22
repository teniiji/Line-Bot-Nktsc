"use client";

import { useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

type Counts = {
  expenses: number;
  serviceRequestLogs: number;
  pendingTransactions: number;
  pendingServiceRequests: number;
  pendingMemberLookups: number;
  memberRoster: number;
  lineUsers: number;
};

const COUNT_LABELS: Record<keyof Counts, string> = {
  expenses: "รายการธุรกรรม",
  serviceRequestLogs: "ทะเบียนคำขอบริการ",
  pendingTransactions: "ธุรกรรมที่ค้างระหว่างทำ",
  pendingServiceRequests: "คำขอที่ค้างระหว่างทำ",
  pendingMemberLookups: "การค้นหาเลขสมาชิกที่ค้างอยู่",
  memberRoster: "ทะเบียนสมาชิก",
  lineUsers: "บัญชี LINE ที่ผูกกับเลขสมาชิกนี้",
};

const totalOf = (counts: Counts) =>
  Object.values(counts).reduce((sum, n) => sum + n, 0);

export default function TestDataCleanupPanel() {
  const [memberNumber, setMemberNumber] = useState("");
  const [preview, setPreview] = useState<Counts | null>(null);
  const [previewFor, setPreviewFor] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const trimmed = memberNumber.trim();

  const handlePreview = async () => {
    if (!trimmed) return;
    setBusy(true);
    setMessage(null);
    setPreview(null);
    try {
      const res = await fetch(
        `/api/test-data?memberNumber=${encodeURIComponent(trimmed)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ตรวจสอบไม่สำเร็จ");
      setPreview(data.counts);
      setPreviewFor(trimmed);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "ตรวจสอบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setConfirming(false);
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/test-data?memberNumber=${encodeURIComponent(previewFor)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "ลบไม่สำเร็จ");
      const total = totalOf(data.deleted);
      setMessage(`ลบข้อมูลของ ${previewFor} แล้ว ${total} แถว`);
      setPreview(null);
      setPreviewFor("");
      setMemberNumber("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  // A stale preview (input changed since it was fetched) must never drive a
  // delete — the delete always targets previewFor, and the button hides
  // whenever the two drift apart.
  const previewCurrent = preview !== null && previewFor === trimmed;
  const previewTotal = preview ? totalOf(preview) : 0;

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="font-semibold">ล้างข้อมูลทดสอบ</h2>
        <p className="text-sm text-slate-500">
          ลบข้อมูลทุกตารางของเลขสมาชิกที่ระบุในคลิกเดียว (ธุรกรรม, คำขอบริการ,
          ทะเบียน, บัญชี LINE, รายการค้าง) — ใช้กับเลขสมาชิกทดสอบ เช่น TEST9999
          เท่านั้น ข้อมูลที่ลบแล้วกู้คืนไม่ได้
        </p>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-sm text-slate-600 mb-1">เลขสมาชิก</label>
            <input
              type="text"
              value={memberNumber}
              onChange={(e) => setMemberNumber(e.target.value)}
              placeholder="เช่น TEST9999"
              className="border border-slate-300 rounded px-3 py-1.5 text-sm w-44"
            />
          </div>
          <button
            type="button"
            onClick={handlePreview}
            disabled={busy || !trimmed}
            className="border border-slate-300 rounded px-4 py-1.5 text-sm font-medium disabled:opacity-40"
          >
            ตรวจสอบ
          </button>
          {previewCurrent && previewTotal > 0 && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={busy}
              className="bg-red-600 text-white rounded px-4 py-1.5 text-sm font-medium disabled:opacity-40"
            >
              ลบทั้งหมด ({previewTotal} แถว)
            </button>
          )}
        </div>

        {previewCurrent && (
          <div className="text-sm text-slate-600">
            {previewTotal === 0 ? (
              <p>ไม่พบข้อมูลของเลขสมาชิก {previewFor}</p>
            ) : (
              <ul className="space-y-0.5">
                {(Object.keys(COUNT_LABELS) as (keyof Counts)[])
                  .filter((key) => preview![key] > 0)
                  .map((key) => (
                    <li key={key}>
                      {COUNT_LABELS[key]}: {preview![key]} แถว
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}

        {message && <p className="text-sm text-slate-700">{message}</p>}
      </div>

      <ConfirmDialog
        open={confirming}
        title={`ลบข้อมูลทั้งหมดของ ${previewFor}?`}
        description={`จะลบ ${previewTotal} แถวจากทุกตารางอย่างถาวร กู้คืนไม่ได้ — ตรวจสอบให้แน่ใจว่าเป็นเลขสมาชิกทดสอบ ไม่ใช่สมาชิกจริง`}
        confirmLabel="ลบถาวร"
        onConfirm={handleDelete}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
