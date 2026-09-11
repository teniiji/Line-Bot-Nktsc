"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
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
  const [editFullName, setEditFullName] = useState("");
  const [editMemberNumber, setEditMemberNumber] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<LineUser | null>(null);
  const [bulkAction, setBulkAction] = useState<"pause" | "resume" | null>(null);

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
    setEditFullName(user.fullName ?? "");
    setEditMemberNumber(user.memberNumber ?? "");
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
    setEditFullName("");
    setEditMemberNumber("");
    setEditError(null);
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/line-users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: editValue.trim() || null,
          fullName: editFullName.trim() || null,
          memberNumber: editMemberNumber.trim() || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        // Stays open with the reason on screen: a rejected member number is
        // something to correct, and closing the form would throw away what
        // was typed along with the explanation.
        setEditError(body.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      // Refetched rather than merged: สังกัด is joined from MemberRoster by
      // the member number, so changing the number changes it too, and the PUT
      // response cannot know the new value.
      await fetchUsers();
      cancelEdit();
    } finally {
      setSaving(false);
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

  // Bulk-pauses/resumes everyone matching the current search — not just the
  // page on screen, so this stays correct on page 2+ of a long list. `total`
  // already tracks exactly that count (it's the same `where` the GET route
  // used), so the confirm dialog can tell staff how many people are affected
  // before they commit.
  const handleConfirmBulk = async () => {
    if (!bulkAction) return;
    setBulkAction(null);
    await fetch("/api/line-users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botPaused: bulkAction === "pause", search }),
    });
    await fetchUsers();
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100 flex-wrap">
        <div>
          <h2 className="font-semibold">สมาชิกที่เคยทักบอท (LINE)</h2>
          <p className="text-xs text-slate-500 mt-1">
            ปิด "บอทตอบอัตโนมัติ" ของคนใดคนหนึ่งได้ เวลาเจ้าหน้าที่กำลังคุยกับสมาชิกคนนั้นเองใน
            chat.line.biz — บอทจะไม่ตอบข้อความจากคนนี้เลย (ไม่กระทบสมาชิกคนอื่น) — "เลขสมาชิก"/"สังกัด"
            จะขึ้นก็ต่อเมื่อคนนั้นเคยยืนยันตัวตนตอนบันทึกธุรกรรมแล้วเท่านั้น หรือปิด/เปิดพร้อมกันทั้งหมด
            (เฉพาะที่ตรงกับคำค้นหาถ้ามี) ด้วยปุ่มด้านขวา
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="ค้นหาชื่อ, ชื่อเล่น, เลขสมาชิก, หรือ LINE UserId"
            className="text-sm border border-slate-300 rounded px-3 py-1.5 w-64"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setBulkAction("pause")}
              disabled={loading || total === 0}
              className="text-xs px-2.5 py-1.5 border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              ปิดทั้งหมด
            </button>
            <button
              type="button"
              onClick={() => setBulkAction("resume")}
              disabled={loading || total === 0}
              className="text-xs px-2.5 py-1.5 border border-slate-300 text-slate-600 rounded hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              เปิดทั้งหมด
            </button>
          </div>
        </div>
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
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-slate-100 text-slate-600 text-left">
              <tr>
                <th className="px-4 py-2">LINE User ID</th>
                <th className="px-4 py-2">ชื่อที่แสดงใน LINE</th>
                <th className="px-4 py-2">ชื่อเล่น</th>
                <th className="px-4 py-2">ชื่อ-นามสกุล</th>
                <th className="px-4 py-2">เลขสมาชิก</th>
                <th className="px-4 py-2">สังกัด</th>
                <th className="px-4 py-2">บอทตอบอัตโนมัติ</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <Fragment key={user.id}>
                <tr className="border-t border-slate-100">
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
                    {editingId === user.id ? (
                      <input
                        type="text"
                        value={editFullName}
                        onChange={(e) => setEditFullName(e.target.value)}
                        placeholder="ชื่อ-นามสกุล"
                        className="border border-slate-300 rounded px-2 py-1 text-sm w-full"
                      />
                    ) : user.rosterName ? (
                      // The cooperative's own spelling wins over what the
                      // member typed — they disagree in small ways, and the
                      // roster is the record. What they typed is still what
                      // the edit box holds, and is shown beside it when the
                      // two differ so neither is a surprise.
                      <>
                        {user.rosterName}
                        {user.fullName && user.fullName !== user.rosterName && (
                          <span className="block text-xs text-slate-400">
                            สมาชิกพิมพ์ว่า {user.fullName}
                          </span>
                        )}
                      </>
                    ) : (
                      (user.fullName ?? "—")
                    )}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {editingId === user.id ? (
                      <input
                        type="text"
                        value={editMemberNumber}
                        onChange={(e) => setEditMemberNumber(e.target.value)}
                        placeholder="เลขสมาชิก"
                        className="border border-slate-300 rounded px-2 py-1 text-sm w-28"
                      />
                    ) : (
                      (user.memberNumber ?? "—")
                    )}
                  </td>
                  {/* Read-only on purpose: สังกัด lives in the roster, keyed by
                      the member number. Typing it here would let this screen
                      drift from the roster; filling in the number populates it. */}
                  <td className="px-4 py-2">
                    {user.unitName ? (
                      user.unitName
                    ) : !user.memberNumber ? (
                      <span className="text-slate-400 text-xs">ยังไม่มีเลขสมาชิก</span>
                    ) : !user.inRoster ? (
                      <span className="text-amber-700 text-xs">
                        ไม่พบเลขนี้ในทะเบียนสมาชิก — อาจพิมพ์ผิด
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs">ทะเบียนไม่ได้ระบุสังกัด</span>
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
                {editingId === user.id && (
                  <tr className="bg-slate-50">
                    <td colSpan={8} className="px-4 pb-3 text-xs">
                      {editError && <p className="text-red-600 mb-1">{editError}</p>}
                      <p className="text-slate-500">
                        เลขสมาชิกที่เจ้าหน้าที่กรอกเองจะยังนับเป็น
                        <strong> "ยังไม่ยืนยัน"</strong> — ธุรกรรมของสมาชิกคนนี้จะขึ้นเตือนต่อไป
                        จนกว่าสมาชิกจะแจ้งชื่อ-เลขสมาชิกกับบอทเอง
                        เพราะการที่เจ้าหน้าที่พิมพ์ให้ เป็นหลักฐานที่อ่อนกว่าสมาชิกยืนยันจากเครื่องตัวเอง
                      </p>
                      <p className="text-slate-400 mt-1">
                        สังกัดแก้ที่นี่ไม่ได้ — ดึงมาจากทะเบียนสมาชิกโดยใช้เลขสมาชิก
                        ใส่เลขสมาชิกให้ถูก แล้วสังกัดจะขึ้นเอง
                      </p>
                    </td>
                  </tr>
                )}
                </Fragment>
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

      <ConfirmDialog
        open={bulkAction !== null}
        title={bulkAction === "pause" ? "ปิดบอทตอบอัตโนมัติทั้งหมด?" : "เปิดบอทตอบอัตโนมัติทั้งหมด?"}
        description={
          bulkAction
            ? `จะ${bulkAction === "pause" ? "ปิด" : "เปิด"}บอทตอบอัตโนมัติของสมาชิก ${total} คน${
                search ? ` ที่ตรงกับคำค้นหา "${search}"` : ""
              }${
                bulkAction === "pause"
                  ? " — บอทจะไม่ตอบข้อความจากคนเหล่านี้เลยจนกว่าจะเปิดกลับทีละคนหรือกด \"เปิดทั้งหมด\" อีกครั้ง (ไม่กระทบสวิตช์ระบบใน \"ตั้งค่าระบบ\")"
                  : " — บอทจะกลับมาตอบข้อความของคนเหล่านี้ตามปกติ"
              }`
            : undefined
        }
        confirmLabel={bulkAction === "pause" ? "ปิดทั้งหมด" : "เปิดทั้งหมด"}
        onConfirm={handleConfirmBulk}
        onCancel={() => setBulkAction(null)}
      />
    </div>
  );
}
