"use client";

import { useEffect, useState } from "react";
import { LineUser } from "@/lib/types";

export default function LineUsersPanel() {
  const [users, setUsers] = useState<LineUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    const res = await fetch("/api/line-users");
    const data = await res.json();
    setUsers(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const startEdit = (user: LineUser) => {
    setEditingId(user.id);
    setEditValue(user.nickname ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/line-users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: editValue.trim() || null }),
      });
      if (res.ok) {
        const updated: LineUser = await res.json();
        setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
      }
    } finally {
      setSaving(false);
      setEditingId(null);
      setEditValue("");
    }
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="font-semibold">สมาชิกที่เคยทักบอท (LINE)</h2>
      </div>

      {loading ? (
        <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
      ) : users.length === 0 ? (
        <p className="text-slate-500 text-sm py-8 text-center">
          ยังไม่มีสมาชิกทักบอท — รายชื่อจะแสดงที่นี่หลังมีคนทักครั้งแรก
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-slate-100 text-slate-600 text-left">
              <tr>
                <th className="px-4 py-2">LINE User ID</th>
                <th className="px-4 py-2">ชื่อที่แสดงใน LINE</th>
                <th className="px-4 py-2">ชื่อเล่น</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-slate-100">
                  <td
                    className="px-4 py-2 font-mono text-xs text-slate-500 whitespace-nowrap"
                    title={user.id}
                  >
                    {user.id}
                  </td>
                  <td className="px-4 py-2">{user.displayName ?? "—"}</td>
                  <td className="px-4 py-2">
                    {editingId === user.id ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="border border-slate-300 rounded px-2 py-1 text-sm w-full"
                        autoFocus
                      />
                    ) : (
                      user.nickname ?? "—"
                    )}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-right space-x-3">
                    {editingId === user.id ? (
                      <>
                        <button
                          onClick={() => saveEdit(user.id)}
                          disabled={saving}
                          className="text-slate-900 hover:underline py-1 disabled:opacity-50"
                        >
                          บันทึก
                        </button>
                        <button
                          onClick={cancelEdit}
                          disabled={saving}
                          className="text-slate-500 hover:underline py-1 disabled:opacity-50"
                        >
                          ยกเลิก
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => startEdit(user)}
                        className="text-slate-600 hover:underline py-1"
                      >
                        แก้ไข
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
