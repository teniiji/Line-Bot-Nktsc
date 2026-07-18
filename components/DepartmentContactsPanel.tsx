"use client";

import { useEffect, useState } from "react";
import { DEPARTMENTS } from "@/lib/departments";
import ConfirmDialog from "@/components/ConfirmDialog";

interface DepartmentContact {
  id: string;
  department: string;
  lineUserId: string;
  name: string | null;
  createdAt: string;
}

// "สินเชื่อ" routes per-member via the responsible-code/unit system
// (imported from Excel, see README) rather than this table, so it isn't
// offered here — adding a row for it here would silently never be used.
const ASSIGNABLE_DEPARTMENTS = DEPARTMENTS.filter((d) => d !== "สินเชื่อ");

export default function DepartmentContactsPanel() {
  const [contacts, setContacts] = useState<DepartmentContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [department, setDepartment] = useState<string>(ASSIGNABLE_DEPARTMENTS[0]);
  const [name, setName] = useState("");
  const [lineUserId, setLineUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DepartmentContact | null>(null);

  const fetchContacts = async () => {
    setLoading(true);
    const res = await fetch("/api/department-contacts");
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
    if (!lineUserId.trim()) {
      setError("ต้องระบุ LINE UserId");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/department-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department, name: name.trim() || null, lineUserId: lineUserId.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "เพิ่มไม่สำเร็จ");
        return;
      }
      setName("");
      setLineUserId("");
      await fetchContacts();
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await fetch(`/api/department-contacts/${id}`, { method: "DELETE" });
    await fetchContacts();
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="font-semibold">ผู้รับผิดชอบตามแผนก (ยกเว้นสินเชื่อ)</h2>
        <p className="text-xs text-slate-500 mt-1">
          คำขอที่ส่งเข้าแต่ละแผนกจะถูกส่งข้อความหาเจ้าหน้าที่ทุกคนที่เพิ่มไว้ในแผนกนั้นพร้อมกัน —
          แผนกที่ยังไม่มีเจ้าหน้าที่เลยจะส่งไปที่ผู้รับทั่วไป (LINE_FORWARD_GENERAL_ID) แทน
        </p>
      </div>

      <form onSubmit={handleAdd} className="px-4 py-3 border-b border-slate-100 flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">แผนก</label>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1.5 text-sm"
          >
            {ASSIGNABLE_DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">ชื่อเจ้าหน้าที่ (ไม่บังคับ)</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1.5 text-sm"
            placeholder="เช่น สมชาย"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-slate-500 mb-1">LINE UserId</label>
          <input
            type="text"
            value={lineUserId}
            onChange={(e) => setLineUserId(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1.5 text-sm w-full font-mono"
            placeholder="U..."
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="bg-slate-900 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {saving ? "กำลังเพิ่ม…" : "เพิ่ม"}
        </button>
      </form>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2 mx-4 mt-3">{error}</p>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {ASSIGNABLE_DEPARTMENTS.map((d) => {
            const rows = contacts.filter((c) => c.department === d);
            return (
              <div key={d} className="px-4 py-3">
                <p className="text-sm font-medium">
                  {d}{" "}
                  <span className="text-xs text-slate-400 font-normal">
                    ({rows.length} คน{rows.length === 0 ? " — ใช้ผู้รับทั่วไปแทน" : ""})
                  </span>
                </p>
                {rows.length > 0 && (
                  <ul className="mt-1 space-y-1">
                    {rows.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
                        <span>
                          {c.name ? <span className="font-medium">{c.name}</span> : null}{" "}
                          <span className="font-mono text-xs text-slate-500">{c.lineUserId}</span>
                        </span>
                        <button
                          onClick={() => setPendingDelete(c)}
                          className="text-red-600 hover:underline text-xs shrink-0 py-1"
                        >
                          ลบ
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="ลบเจ้าหน้าที่คนนี้ออกจากแผนก?"
        description={
          pendingDelete
            ? `${pendingDelete.name ?? pendingDelete.lineUserId} จะไม่ได้รับคำขอที่ส่งเข้าแผนก "${pendingDelete.department}" อีกต่อไป`
            : undefined
        }
        confirmLabel="ลบ"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
