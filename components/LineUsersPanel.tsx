"use client";

import { useCallback, useEffect, useState } from "react";
import { LineUser } from "@/lib/types";
import ConfirmDialog from "@/components/ConfirmDialog";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

export default function LineUsersPanel() {
  const [users, setUsers] = useState<LineUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LineUser | null>(null);

  // Debounce the search box so every keystroke doesn't fire a request —
  // commits to `search` (which actually triggers the fetch) 300ms after
  // typing stops.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (search) params.set("search", search);
    const res = await fetch(`/api/line-users?${params.toString()}`);
    const data = await res.json();
    setUsers(data.data);
    setTotal(data.total);
    setLoading(false);
  }, [page, search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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

  const togglePause = async (id: string, next: boolean) => {
    setTogglingId(id);
    const previous = users;
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, botPaused: next } : u)));
    try {
      const res = await fetch(`/api/line-users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botPaused: next }),
      });
      if (!res.ok) {
        setUsers(previous);
      }
    } finally {
      setTogglingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await fetch(`/api/line-users/${id}`, { method: "DELETE" });
    await fetchUsers();
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <div>
          <h2 className="font-semibold">สมาชิกที่เคยทักบอท (LINE)</h2>
          <p className="text-xs text-slate-500 mt-1">
            ปิด "บอทตอบอัตโนมัติ" ของคนใดคนหนึ่งได้ เวลาเจ้าหน้าที่กำลังคุยกับสมาชิกคนนั้นเองใน
            chat.line.biz — บอทจะไม่ตอบข้อความจากคนนี้เลย (ไม่กระทบสมาชิกคนอื่น)
          </p>
        </div>
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="ค้นหาชื่อ, ชื่อเล่น, หรือ LINE UserId"
          className="text-sm border border-slate-300 rounded px-3 py-1.5 w-64"
        />
      </div>

      {loading ? (
        <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
      ) : users.length === 0 ? (
        <p className="text-slate-500 text-sm py-8 text-center">
          {search
            ? "ไม่พบสมาชิกที่ตรงกับคำค้นหา"
            : "ยังไม่มีสมาชิกทักบอท — รายชื่อจะแสดงที่นี่หลังมีคนทักครั้งแรก"}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead className="bg-slate-100 text-slate-600 text-left">
              <tr>
                <th className="px-4 py-2">LINE User ID</th>
                <th className="px-4 py-2">ชื่อที่แสดงใน LINE</th>
                <th className="px-4 py-2">ชื่อเล่น</th>
                <th className="px-4 py-2">บอทตอบอัตโนมัติ</th>
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
                  <td className="px-4 py-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!user.botPaused}
                      aria-label="บอทตอบอัตโนมัติ"
                      disabled={togglingId === user.id}
                      onClick={() => togglePause(user.id, !user.botPaused)}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                        user.botPaused ? "bg-slate-300" : "bg-green-600"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          user.botPaused ? "translate-x-1" : "translate-x-6"
                        }`}
                      />
                    </button>
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
                      <>
                        <button
                          onClick={() => startEdit(user)}
                          className="text-slate-600 hover:underline py-1"
                        >
                          แก้ไข
                        </button>
                        <button
                          onClick={() => setPendingDelete(user)}
                          className="text-red-600 hover:underline py-1"
                        >
                          ลบ
                        </button>
                      </>
                    )}
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
            หน้า {page} / {totalPages} ({total} คน)
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
        open={pendingDelete !== null}
        title="ลบสมาชิกคนนี้จากรายชื่อ?"
        description={
          pendingDelete
            ? `จะลบแค่ชื่อเล่น/สถานะบอทตอบอัตโนมัติของ "${
                pendingDelete.nickname || pendingDelete.displayName || pendingDelete.id
              }" — ไม่กระทบประวัติธุรกรรม/คำขอบริการที่เคยบันทึกไว้ ถ้าทักบอทเข้ามาใหม่จะถูกเพิ่มกลับมาในรายชื่ออัตโนมัติ`
            : undefined
        }
        confirmLabel="ลบ"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
