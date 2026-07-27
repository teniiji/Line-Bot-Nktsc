"use client";

import { useEffect, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

interface FormLink {
  id: string;
  key: string;
  label: string;
  url: string;
  updatedAt: string;
}

export default function FormLinksPanel() {
  const [links, setLinks] = useState<FormLink[]>([]);
  const [loading, setLoading] = useState(true);

  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FormLink | null>(null);

  const fetchLinks = async () => {
    setLoading(true);
    const res = await fetch("/api/form-links");
    const data = await res.json();
    setLinks(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchLinks();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!newKey.trim() || !newLabel.trim() || !newUrl.trim()) {
      setError("ต้องระบุ key, ชื่อแบบฟอร์ม และลิงก์");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/form-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: newKey.trim(),
          label: newLabel.trim(),
          url: newUrl.trim(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "เพิ่มไม่สำเร็จ");
        return;
      }
      setNewKey("");
      setNewLabel("");
      setNewUrl("");
      await fetchLinks();
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (link: FormLink) => {
    setEditingId(link.id);
    setEditLabel(link.label);
    setEditUrl(link.url);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditLabel("");
    setEditUrl("");
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/form-links/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: editLabel.trim(), url: editUrl.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "บันทึกไม่สำเร็จ");
        return;
      }
      cancelEdit();
      await fetchLinks();
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await fetch(`/api/form-links/${id}`, { method: "DELETE" });
    await fetchLinks();
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="font-semibold">ลิงก์แบบฟอร์ม</h2>
        <p className="text-xs text-slate-500 mt-1">
          เมื่อสมาชิกขอแบบฟอร์มที่มีในรายการนี้ บอทจะตอบลิงก์ให้ตรงตัว — ถ้าไม่มีแบบฟอร์มนั้นในรายการ
          บอทจะแนะนำให้ติดต่อสำนักงานแทนเหมือนเดิม
        </p>
      </div>

      <form onSubmit={handleAdd} className="px-4 py-3 border-b border-slate-100 flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">key</label>
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1.5 text-sm w-32"
            placeholder="เช่น loan_general"
          />
        </div>
        <div className="min-w-[180px]">
          <label className="block text-xs text-slate-500 mb-1">ชื่อแบบฟอร์ม</label>
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1.5 text-sm w-full"
            placeholder="เช่น แบบฟอร์มกู้เงินสามัญ"
          />
        </div>
        <div className="flex-1 min-w-[220px]">
          <label className="block text-xs text-slate-500 mb-1">ลิงก์</label>
          <input
            type="text"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1.5 text-sm w-full"
            placeholder="https://drive.google.com/..."
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
      ) : links.length === 0 ? (
        <p className="text-slate-500 text-sm py-8 text-center">
          ยังไม่มีลิงก์แบบฟอร์ม — เพิ่มด้วยฟอร์มด้านบน
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {links.map((link) => (
            <li key={link.id} className="px-4 py-3">
              {editingId === link.id ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">key: {link.key}</p>
                  <input
                    type="text"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                    placeholder="ชื่อแบบฟอร์ม"
                  />
                  <input
                    type="text"
                    value={editUrl}
                    onChange={(e) => setEditUrl(e.target.value)}
                    className="w-full border border-slate-300 rounded px-3 py-2 text-sm font-mono"
                    placeholder="ลิงก์"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(link.id)}
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
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{link.label}</p>
                    <p className="text-xs text-slate-500 truncate">
                      key: {link.key} — <span className="font-mono">{link.url}</span>
                    </p>
                  </div>
                  <div className="flex gap-3 shrink-0">
                    <button
                      onClick={() => startEdit(link)}
                      className="text-slate-600 hover:underline text-sm py-1"
                    >
                      แก้ไข
                    </button>
                    <button
                      onClick={() => setPendingDelete(link)}
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
        title="ลบลิงก์แบบฟอร์มนี้?"
        description={
          pendingDelete ? `บอทจะไม่มีลิงก์ให้ตอบสำหรับ "${pendingDelete.label}" อีก` : undefined
        }
        confirmLabel="ลบ"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
