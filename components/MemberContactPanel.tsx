"use client";

import { useCallback, useEffect, useState } from "react";
import { MemberRosterEntry } from "@/lib/types";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;

export default function MemberContactPanel() {
  const [members, setMembers] = useState<MemberRosterEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNationalId, setEditNationalId] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const fetchMembers = useCallback(async () => {
    if (search.length < MIN_SEARCH_LENGTH) {
      setMembers([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({
      search,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    const res = await fetch(`/api/member-roster?${params.toString()}`);
    const data = await res.json();
    setMembers(data.data);
    setTotal(data.total);
    setLoading(false);
  }, [page, search]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const startEdit = (member: MemberRosterEntry) => {
    setEditingId(member.id);
    setEditNationalId(member.nationalId ?? "");
    setEditPhone(member.phone ?? "");
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditNationalId("");
    setEditPhone("");
    setError(null);
  };

  const saveEdit = async (memberNumber: string) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/member-roster/${memberNumber}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nationalId: editNationalId.trim(), phone: editPhone.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "บันทึกไม่สำเร็จ");
        return;
      }
      setMembers((prev) => prev.map((m) => (m.id === body.id ? body : m)));
      setEditingId(null);
      setEditNationalId("");
      setEditPhone("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <div>
          <h2 className="font-semibold">แก้ไขข้อมูลยืนยันตัวตนสมาชิก</h2>
          <p className="text-xs text-slate-500 mt-1">
            ใช้เมื่อสมาชิกโทรแจ้งเปลี่ยนเบอร์โทร หรือข้อมูลเลขบัตรผิด — ค้นหาด้วยเลขสมาชิกหรือชื่อ
            แล้วแก้ไขได้ทันที ข้อมูลนี้ใช้ยืนยันตัวตนก่อนแจ้งเลขสมาชิกทาง LINE เท่านั้น
          </p>
        </div>
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="ค้นหาเลขสมาชิกหรือชื่อ"
          className="text-sm border border-slate-300 rounded px-3 py-1.5 w-64"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2 mx-4 mt-3">{error}</p>
      )}

      {search.length < MIN_SEARCH_LENGTH ? (
        <p className="text-slate-500 text-sm py-8 text-center">
          พิมพ์เลขสมาชิกหรือชื่ออย่างน้อย {MIN_SEARCH_LENGTH} ตัวอักษรเพื่อค้นหา
        </p>
      ) : loading ? (
        <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
      ) : members.length === 0 ? (
        <p className="text-slate-500 text-sm py-8 text-center">ไม่พบสมาชิกที่ตรงกับคำค้นหา</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-slate-100 text-slate-600 text-left">
              <tr>
                <th className="px-4 py-2">เลขสมาชิก</th>
                <th className="px-4 py-2">ชื่อสมาชิก</th>
                <th className="px-4 py-2">เลขบัตรประชาชน</th>
                <th className="px-4 py-2">เบอร์โทร</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">
                    {member.memberNumber}
                  </td>
                  <td className="px-4 py-2">{member.memberName}</td>
                  <td className="px-4 py-2">
                    {editingId === member.id ? (
                      <input
                        type="text"
                        value={editNationalId}
                        onChange={(e) => setEditNationalId(e.target.value)}
                        className="border border-slate-300 rounded px-2 py-1 text-sm w-40 font-mono"
                        placeholder="13 หลัก"
                        autoFocus
                      />
                    ) : (
                      member.nationalId ?? "—"
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {editingId === member.id ? (
                      <input
                        type="text"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        className="border border-slate-300 rounded px-2 py-1 text-sm w-32 font-mono"
                        placeholder="0812345678"
                      />
                    ) : (
                      member.phone ?? "—"
                    )}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-right space-x-3">
                    {editingId === member.id ? (
                      <>
                        <button
                          onClick={() => saveEdit(member.memberNumber)}
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
                        onClick={() => startEdit(member)}
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
    </div>
  );
}
