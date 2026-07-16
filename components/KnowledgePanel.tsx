"use client";

import { useEffect, useState } from "react";

interface KnowledgeEntry {
  id: string;
  key: string;
  title: string;
  content: string;
  sortOrder: number;
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

export default function KnowledgePanel() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = async () => {
    setLoading(true);
    const res = await fetch("/api/knowledge");
    const data = await res.json();
    setEntries(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchEntries();
  }, []);

  const startEdit = (entry: KnowledgeEntry) => {
    setEditingId(entry.id);
    setEditTitle(entry.title);
    setEditContent(entry.content);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTitle("");
    setEditContent("");
    setError(null);
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/knowledge/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle, content: editContent }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "บันทึกไม่สำเร็จ");
        return;
      }
      const updated: KnowledgeEntry = await res.json();
      setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
      cancelEdit();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="font-semibold">ฐานความรู้ของบอท (อัตราดอกเบี้ย / สวัสดิการ / ข้อมูลติดต่อ)</h2>
        <p className="text-xs text-slate-500 mt-1">
          บอทใช้ข้อมูลชุดนี้ตอบคำถามสมาชิกโดยตรง — แก้ไขแล้วมีผลภายในประมาณ 1 นาที ไม่ต้อง deploy ใหม่
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2 mx-4 mt-3">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
      ) : entries.length === 0 ? (
        <p className="text-slate-500 text-sm py-8 text-center">
          ยังไม่มีข้อมูลในตาราง — บอทกำลังใช้ค่าเริ่มต้นที่ฝังไว้ในระบบ (รัน migration เพื่อ seed ข้อมูล)
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {entries.map((entry) => (
            <li key={entry.id} className="px-4 py-3">
              {editingId === entry.id ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full border border-slate-300 rounded px-3 py-2 text-sm font-medium"
                  />
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={3}
                    className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(entry.id)}
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
                    <p className="font-medium text-sm">{entry.title}</p>
                    <p className="text-sm text-slate-600 whitespace-pre-wrap">
                      {entry.content}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      แก้ไขล่าสุด {formatDateTime(entry.updatedAt)}
                    </p>
                  </div>
                  <button
                    onClick={() => startEdit(entry)}
                    className="text-slate-600 hover:underline text-sm shrink-0 py-1"
                  >
                    แก้ไข
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
