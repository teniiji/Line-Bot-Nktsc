"use client";

import { useCallback, useEffect, useState } from "react";
import { MemberRosterEntry } from "@/lib/types";
import ConfirmDialog from "@/components/ConfirmDialog";
import { downloadMemberRosterCsv } from "@/lib/csv";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

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
  const [pendingUnlink, setPendingUnlink] = useState<MemberRosterEntry | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const fetchMembers = useCallback(async () => {
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
      setMembers((prev) =>
        prev.map((m) => (m.id === body.id ? { ...m, ...body, nationalIdMasked: false } : m))
      );
      setEditingId(null);
      setEditNationalId("");
      setEditPhone("");
    } finally {
      setSaving(false);
    }
  };

  const confirmUnlink = async () => {
    if (!pendingUnlink) return;
    const memberNumber = pendingUnlink.memberNumber;
    setPendingUnlink(null);
    setError(null);
    const res = await fetch(`/api/member-roster/${memberNumber}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lineUserId: "" }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "ปลดการเชื่อมต่อไม่สำเร็จ");
      return;
    }
    setMembers((prev) =>
      prev.map((m) => (m.id === body.id ? { ...m, lineUserId: body.lineUserId } : m))
    );
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <div>
          <h2 className="font-semibold">ทะเบียนสมาชิก</h2>
          <p className="text-xs text-slate-500 mt-1">
            เปิดดูได้ทั้งทะเบียน (แบ่งหน้า) หรือค้นด้วยเลขสมาชิก ชื่อ หรือสังกัด — แก้เบอร์โทรและ
            เลขบัตรประชาชนได้ทันทีเมื่อสมาชิกโทรแจ้ง ข้อมูลนี้ใช้ยืนยันตัวตนก่อนแจ้งเลขสมาชิกทาง
            LINE เท่านั้น คอลัมน์ <strong>"เลขบัญชีที่ผูกไว้"</strong> คือทะเบียนเลขบัญชีเดียวกับที่แท็บ
            "เทียบ Statement" ดึงมาแสดงให้ตรงนี้ด้วย จะได้ไม่ต้องเปิดสองแท็บ
            ส่วนคอลัมน์ "เชื่อมต่อ LINE" บอกว่าเลขสมาชิกนี้ผูกกับบัญชี LINE ไหนอยู่ — ถ้าสมาชิกแจ้งว่า
            บอทตอบว่า "เลขสมาชิกนี้ผูกกับบัญชี LINE อื่นแล้ว" (เช่น เปลี่ยนเครื่อง/เปลี่ยนบัญชี LINE
            หรือค้างจาก LINE OA ช่องเดิม) ให้กด "ปลด" แล้วสมาชิกจะผูกใหม่ได้เองในข้อความถัดไป
          </p>
          <p className="text-xs text-amber-700 mt-1">
            🔒 ตอนเปิดดูทั้งทะเบียน <strong>เลขบัตรประชาชนจะถูกซ่อนไว้ เหลือ 4 ตัวท้าย</strong> —
            ค้นหาสมาชิกคนที่ต้องการยืนยันตัวตน แล้วจะเห็นเลขเต็ม · ไฟล์ CSV
            <strong>ไม่มีคอลัมน์เลขบัตรประชาชนเลย</strong> มีแค่ว่ามีในระบบหรือไม่
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="ค้นหาเลขสมาชิก ชื่อ หรือสังกัด"
            className="text-sm border border-slate-300 rounded px-3 py-1.5 w-64"
          />
          <button
            onClick={() => downloadMemberRosterCsv(members)}
            disabled={members.length === 0}
            className="text-sm px-3 py-1.5 border border-slate-300 rounded whitespace-nowrap disabled:opacity-40"
            title="ส่งออกเฉพาะหน้านี้ ไม่รวมเลขบัตรประชาชน"
          >
            ส่งออก CSV
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2 mx-4 mt-3">{error}</p>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
      ) : members.length === 0 ? (
        <p className="text-slate-500 text-sm py-8 text-center">
          {search ? "ไม่พบสมาชิกที่ตรงกับคำค้นหา" : "ยังไม่มีสมาชิกในทะเบียน"}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-slate-100 text-slate-600 text-left">
              <tr>
                <th className="px-4 py-2">เลขสมาชิก</th>
                <th className="px-4 py-2">ชื่อสมาชิก</th>
                <th className="px-4 py-2">เลขบัตรประชาชน</th>
                <th className="px-4 py-2">เบอร์โทร</th>
                <th className="px-4 py-2">เลขบัญชีที่ผูกไว้</th>
                <th className="px-4 py-2">เชื่อมต่อ LINE</th>
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
                    ) : member.nationalId === null ? (
                      "—"
                    ) : (
                      <span
                        className="font-mono"
                        title={
                          member.nationalIdMasked
                            ? "ซ่อนไว้ตอนเปิดดูทั้งทะเบียน — ค้นหาสมาชิกคนนี้เพื่อดูเลขเต็ม"
                            : undefined
                        }
                      >
                        {member.nationalId}
                      </span>
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
                  <td className="px-4 py-2">
                    {member.bankAccounts.length === 0 ? (
                      <span className="text-slate-300">—</span>
                    ) : (
                      <span className="font-mono text-xs">
                        {member.bankAccounts.join(" · ")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {member.lineUserId ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs border bg-green-50 text-green-700 border-green-200">
                          เชื่อมแล้ว
                        </span>
                        <button
                          onClick={() => setPendingUnlink(member)}
                          className="text-red-600 hover:underline text-xs py-1"
                        >
                          ปลด
                        </button>
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs">ยังไม่เชื่อม</span>
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

      <ConfirmDialog
        open={pendingUnlink !== null}
        title="ปลดการเชื่อมต่อ LINE ของสมาชิกนี้?"
        description={
          pendingUnlink
            ? `${pendingUnlink.memberName} (เลขสมาชิก ${pendingUnlink.memberNumber}) จะไม่ผูกกับบัญชี LINE เดิมอีก — ` +
              `ครั้งต่อไปที่สมาชิกแจ้งชื่อและเลขสมาชิกกับบอท ระบบจะผูกกับบัญชี LINE ที่ทักเข้ามาให้เองอัตโนมัติ ` +
              `ไม่กระทบธุรกรรมที่บันทึกไปแล้ว`
            : undefined
        }
        confirmLabel="ปลดการเชื่อมต่อ"
        onConfirm={confirmUnlink}
        onCancel={() => setPendingUnlink(null)}
      />
    </div>
  );
}
