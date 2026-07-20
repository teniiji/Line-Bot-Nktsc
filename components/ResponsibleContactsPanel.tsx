"use client";

import { useEffect, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

interface ResponsibleContact {
  id: string;
  code: string;
  lineUserId: string;
  note: string | null;
  updatedAt: string;
}

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function ResponsibleContactsPanel() {
  const [contacts, setContacts] = useState<ResponsibleContact[]>([]);
  const [loading, setLoading] = useState(true);

  const [newCode, setNewCode] = useState("");
  const [newLineUserId, setNewLineUserId] = useState("");
  const [newNote, setNewNote] = useState("");
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLineUserId, setEditLineUserId] = useState("");
  const [editNote, setEditNote] = useState("");
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ResponsibleContact | null>(null);

  const fetchContacts = async () => {
    setLoading(true);
    const res = await fetch("/api/responsible-contacts");
    const data = await res.json();
    setContacts(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchContacts();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!newCode.trim() || !newLineUserId.trim()) {
      setError("ต้องระบุรหัสและ LINE UserId");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/responsible-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: newCode.trim(),
          lineUserId: newLineUserId.trim(),
          note: newNote.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "เพิ่มไม่สำเร็จ");
        return;
      }
      setNewCode("");
      setNewLineUserId("");
      setNewNote("");
      await fetchContacts();
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (contact: ResponsibleContact) => {
    setEditingId(contact.id);
    setEditLineUserId(contact.lineUserId);
    setEditNote(contact.note ?? "");
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditLineUserId("");
    setEditNote("");
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/responsible-contacts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineUserId: editLineUserId.trim(), note: editNote.trim() || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "บันทึกไม่สำเร็จ");
        return;
      }
      cancelEdit();
      await fetchContacts();
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await fetch(`/api/responsible-contacts/${id}`, { method: "DELETE" });
    await fetchContacts();
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="font-semibold">ผู้รับผิดชอบเรื่องกู้เงิน (สินเชื่อ)</h2>
        <p className="text-xs text-slate-500 mt-1">
          จับคู่รหัสผู้รับผิดชอบรายบุคคล (คอลัมน์ H ในชีตสมาชิก) กับ LINE UserId ของเจ้าหน้าที่ —
          รหัสหนึ่งมีผู้รับได้คนเดียว ถ้าไม่พบรหัสของสมาชิก ระบบจะ fallback ไปที่ชื่อหน่วยงาน แล้วค่อยไปที่ผู้รับสำรอง
        </p>
      </div>

      <form onSubmit={handleAdd} className="px-4 py-3 border-b border-slate-100 flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">รหัส</label>
          <input
            type="text"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1.5 text-sm w-20"
            placeholder="เช่น 1"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-slate-500 mb-1">LINE UserId</label>
          <input
            type="text"
            value={newLineUserId}
            onChange={(e) => setNewLineUserId(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1.5 text-sm w-full font-mono"
            placeholder="U..."
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">หมายเหตุ (ไม่บังคับ)</label>
          <input
            type="text"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1.5 text-sm"
            placeholder="เช่น ชื่อเจ้าหน้าที่"
          />
        </div>
        <button
          type="submit"
          disabled={adding}
          className="bg-slate-900 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {adding ? "กำลังเพิ่ม…" : "เพิ่ม"}
        </button>
      </form>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2 mx-4 mt-3">{error}</p>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
      ) : contacts.length === 0 ? (
        <p className="text-slate-500 text-sm py-8 text-center">
          ยังไม่มีรหัสผู้รับผิดชอบ — เพิ่มด้วยฟอร์มด้านบน หรือ import จากไฟล์ Excel
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {contacts.map((contact) => (
            <li key={contact.id} className="px-4 py-3">
              {editingId === contact.id ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">รหัส {contact.code}</p>
                  <input
                    type="text"
                    value={editLineUserId}
                    onChange={(e) => setEditLineUserId(e.target.value)}
                    className="w-full border border-slate-300 rounded px-3 py-2 text-sm font-mono"
                    placeholder="LINE UserId"
                  />
                  <input
                    type="text"
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                    className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                    placeholder="หมายเหตุ (ไม่บังคับ)"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(contact.id)}
                      disabled={saving}
                      className="bg-slate-900 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50"
                    >
                      บันทึก
                    </button>
                    <button
                      onClick={cancelEdit}
                      disabled={saving}
                      className="border border-slate-300 rounded px-3 py-1.5 text-sm disabled:opacity-50"
                    >
                      ยกเลิก
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm">
                      <span className="font-medium">รหัส {contact.code}</span>{" "}
                      <span className="font-mono text-xs text-slate-500">{contact.lineUserId}</span>
                    </p>
                    {contact.note && <p className="text-sm text-slate-600">{contact.note}</p>}
                    <p className="text-xs text-slate-400 mt-1">
                      แก้ไขล่าสุด {formatDateTime(contact.updatedAt)}
                    </p>
                  </div>
                  <div className="flex gap-3 shrink-0">
                    <button
                      onClick={() => startEdit(contact)}
                      className="text-slate-600 hover:underline text-sm py-1"
                    >
                      แก้ไข
                    </button>
                    <button
                      onClick={() => setPendingDelete(contact)}
                      className="text-red-600 hover:underline text-sm py-1"
                    >
                      ลบ
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="ลบรหัสผู้รับผิดชอบนี้?"
        description={
          pendingDelete
            ? `สมาชิกที่ใช้รหัส ${pendingDelete.code} จะ fallback ไปใช้ชื่อหน่วยงาน หรือผู้รับสำรองแทน`
            : undefined
        }
        confirmLabel="ลบ"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
