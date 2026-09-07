"use client";

import { useCallback, useEffect, useState } from "react";
import { OrganizationUnitEntry } from "@/lib/types";

interface LineGroupOption {
  groupId: string;
  name: string | null;
  note: string | null;
}

const SEARCH_DEBOUNCE_MS = 300;

export default function OrganizationUnitsPanel() {
  const [units, setUnits] = useState<OrganizationUnitEntry[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContactName, setEditContactName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editLineUserId, setEditLineUserId] = useState("");
  const [saving, setSaving] = useState(false);
  // The groups the bot is in, so a unit can be pointed at its own group
  // instead of one officer's account — see LineGroupsPanel for how a group
  // gets here.
  const [groups, setGroups] = useState<LineGroupOption[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Only the chats the bot is still in are offered: a group it has been
  // removed from would accept the assignment and then silently drop every
  // file sent to it.
  useEffect(() => {
    fetch("/api/line-groups")
      .then((res) => res.json())
      .then((data: (LineGroupOption & { leftAt: string | null })[]) =>
        setGroups(data.filter((g) => !g.leftAt))
      )
      .catch(() => setGroups([]));
  }, []);

  const groupLabel = (id: string) => {
    const group = groups.find((g) => g.groupId === id);
    if (!group) return null;
    return group.note ?? group.name ?? group.groupId;
  };

  const fetchUnits = useCallback(async () => {
    setLoading(true);
    const params = search ? `?search=${encodeURIComponent(search)}` : "";
    const res = await fetch(`/api/organization-units${params}`);
    const body = await res.json();
    setUnits(body.data ?? []);
    setLoading(false);
  }, [search]);

  useEffect(() => {
    if (open) fetchUnits();
  }, [open, fetchUnits]);

  const startEdit = (u: OrganizationUnitEntry) => {
    setEditingId(u.id);
    setEditContactName(u.contactName ?? "");
    setEditEmail(u.email ?? "");
    setEditLineUserId(u.lineUserId ?? "");
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setError(null);
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/organization-units/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactName: editContactName,
          email: editEmail,
          lineUserId: editLineUserId,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "บันทึกไม่สำเร็จ");
        return;
      }
      setUnits((prev) => prev.map((u) => (u.id === body.id ? { ...u, ...body } : u)));
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  };

  const missingLine = units.filter((u) => !u.lineUserId).length;

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <div>
          <h2 className="font-semibold">ผู้รับรายการหัก (รายหน่วยงาน)</h2>
          <p className="text-xs text-slate-500 mt-1">
            แก้ LINE UserID / อีเมล / ชื่อผู้รับ ของแต่ละหน่วยงาน — ใช้เมื่อปุ่ม "ส่ง LINE" ขึ้นว่าส่งไม่สำเร็จ
            หรือหน่วยงานไม่มีปุ่มให้กด (คนละชุดกับแท็บ "ผู้รับผิดชอบ" ซึ่งเป็นเจ้าหน้าที่สินเชื่อ/รายแผนก)
            — <strong>ย้าย LINE OA ใหม่ทุกครั้ง UserID ของทุกหน่วยจะใช้ไม่ได้</strong> ต้องเก็บใหม่จาก chat.line.biz
          </p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-sm px-3 py-1.5 border border-slate-300 rounded whitespace-nowrap"
        >
          {open ? "ซ่อน" : "จัดการผู้รับ"}
        </button>
      </div>

      {open && (
        <>
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="ค้นหาชื่อหน่วยงาน / กลุ่ม / ผู้รับ"
              className="text-sm border border-slate-300 rounded px-3 py-1.5 w-72"
            />
            {!loading && units.length > 0 && missingLine > 0 && (
              <span className="text-xs text-amber-700">
                ยังไม่มี LINE UserID {missingLine} หน่วย — ส่งผ่าน LINE ไม่ได้
              </span>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2 mx-4 mt-3">{error}</p>
          )}

          {loading ? (
            <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
          ) : units.length === 0 ? (
            <p className="text-slate-500 text-sm py-8 text-center">
              {search ? "ไม่พบหน่วยงานที่ตรงกับคำค้นหา" : "ยังไม่มีข้อมูลหน่วยงาน — นำเข้าด้วย import-org-data.ts"}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <thead className="bg-slate-100 text-slate-600 text-left">
                  <tr>
                    <th className="px-4 py-2">หน่วยงาน</th>
                    <th className="px-4 py-2">ผู้รับ</th>
                    <th className="px-4 py-2">อีเมล</th>
                    <th className="px-4 py-2">LINE UserID</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id} className="border-t border-slate-100">
                      <td className="px-4 py-2">
                        {u.name}
                        {u.groupName && (
                          <span className="text-xs text-slate-400"> · {u.groupName}</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {editingId === u.id ? (
                          <input
                            value={editContactName}
                            onChange={(e) => setEditContactName(e.target.value)}
                            className="border border-slate-300 rounded px-2 py-1 text-sm w-36"
                            placeholder="ชื่อผู้รับ"
                            autoFocus
                          />
                        ) : (
                          u.contactName ?? "—"
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {editingId === u.id ? (
                          <input
                            value={editEmail}
                            onChange={(e) => setEditEmail(e.target.value)}
                            className="border border-slate-300 rounded px-2 py-1 text-sm w-48"
                            placeholder="name@example.com"
                          />
                        ) : (
                          u.email ?? "—"
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {editingId === u.id ? (
                          <>
                            <input
                              value={editLineUserId}
                              onChange={(e) => setEditLineUserId(e.target.value)}
                              list="line-group-targets"
                              className="border border-slate-300 rounded px-2 py-1 text-sm w-72 font-mono"
                              placeholder="U… (รายบุคคล) หรือเลือกกลุ่ม"
                            />
                            {groups.length > 0 && (
                              <select
                                value=""
                                onChange={(e) => e.target.value && setEditLineUserId(e.target.value)}
                                className="border border-slate-300 rounded px-2 py-1 text-xs ml-2 bg-white max-w-[12rem]"
                                title="ส่งเข้ากลุ่มของหน่วยงานแทนการส่งหาคนคนเดียว"
                              >
                                <option value="">เลือกกลุ่ม…</option>
                                {groups.map((g) => (
                                  <option key={g.groupId} value={g.groupId}>
                                    {g.note ?? g.name ?? g.groupId}
                                  </option>
                                ))}
                              </select>
                            )}
                          </>
                        ) : u.lineUserId ? (
                          <span>
                            {groupLabel(u.lineUserId) ? (
                              <>
                                <span className="inline-block px-2 py-0.5 rounded-full text-xs border bg-sky-50 text-sky-700 border-sky-200">
                                  👥 กลุ่ม
                                </span>{" "}
                                {groupLabel(u.lineUserId)}
                              </>
                            ) : (
                              <span className="font-mono text-xs">{u.lineUserId}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-amber-700 text-xs">ยังไม่มี</span>
                        )}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-right space-x-3">
                        {editingId === u.id ? (
                          <>
                            <button
                              onClick={() => saveEdit(u.id)}
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
                            onClick={() => startEdit(u)}
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
        </>
      )}
    </div>
  );
}
