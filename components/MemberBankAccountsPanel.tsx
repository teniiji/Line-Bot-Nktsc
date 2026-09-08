"use client";

import { useCallback, useEffect, useState } from "react";
import { MemberBankAccountEntry } from "@/lib/types";
import ConfirmDialog from "@/components/ConfirmDialog";

const SEARCH_DEBOUNCE_MS = 300;

interface ImportResult {
  read?: number;
  imported?: number;
  added?: number;
  repointed?: number;
  unchanged?: number;
  blankRows?: number;
  problemCount?: number;
  problems?: { rowNumber: number; reason: string }[];
  unknownMemberCount?: number;
  unknownMembers?: string[];
  roundsRematched?: number;
  conflictCount?: number;
  conflicts?: { accountNumber: string; memberNumbers: string[] }[];
}

// The directory behind "โอนเข้ามาแต่ไม่พบเจ้าของ". Most entries get added from
// that table with one click; this panel is for seeing what has built up,
// fixing a binding that went to the wrong member, and adding one ahead of
// time when staff already know the account.
export default function MemberBankAccountsPanel() {
  const [entries, setEntries] = useState<MemberBankAccountEntry[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newAccount, setNewAccount] = useState("");
  const [newMember, setNewMember] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMember, setEditMember] = useState("");
  const [pendingDelete, setPendingDelete] = useState<MemberBankAccountEntry | null>(null);
  // The result of a bulk import, kept on screen until the next one: it is a
  // list of things to go and fix (rows with holes, member numbers the roster
  // does not know), not a flash message.
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const params = search ? `?search=${encodeURIComponent(search)}` : "";
    const res = await fetch(`/api/member-bank-accounts${params}`);
    const body = await res.json();
    setEntries(body.data ?? []);
    setLoading(false);
  }, [search]);

  useEffect(() => {
    if (open) fetchEntries();
  }, [open, fetchEntries]);

  const save = async (accountNumber: string, memberNumber: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/member-bank-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountNumber, memberNumber }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "บันทึกไม่สำเร็จ");
        return false;
      }
      await fetchEntries();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const addEntry = async () => {
    if (await save(newAccount.trim(), newMember.trim())) {
      setNewAccount("");
      setNewMember("");
    }
  };

  const saveEdit = async (entry: MemberBankAccountEntry) => {
    if (await save(entry.accountNumber, editMember.trim())) setEditingId(null);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await fetch(`/api/member-bank-accounts/${id}`, { method: "DELETE" });
    await fetchEntries();
  };

  const importFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setBusy(true);
    setError(null);
    setImportResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/member-bank-accounts/import", {
        method: "POST",
        body: form,
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "นำเข้าไฟล์ไม่สำเร็จ");
        // A refusal carries its reasons — which accounts are claimed twice —
        // and those are the whole point of refusing, so they stay on screen.
        if (body.conflicts || body.problems) setImportResult(body);
        return;
      }
      setImportResult(body);
      await fetchEntries();
    } finally {
      setBusy(false);
    }
  };

  const unknownMembers = entries.filter((e) => !e.inRoster).length;

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <div>
          <h2 className="font-semibold">ทะเบียนเลขบัญชีสมาชิก</h2>
          <p className="text-xs text-slate-500 mt-1">
            เลขบัญชีที่สมาชิกใช้โอนเงินเข้าสหกรณ์ ว่าเป็นของสมาชิกคนไหน — ใช้ตอนเทียบ Statement
            เมื่อเลขบัญชีในไฟล์รายชื่อหักไม่ได้ผิดหรือไม่มี ระบบจะมาดูที่นี่ให้เอง
            ส่วนใหญ่ไม่ต้องมากรอกเอง เพราะกด "ระบุเจ้าของ" ในตาราง "โอนเข้ามาแต่ไม่พบเจ้าของ"
            แล้วระบบบันทึกให้เลย <strong>บันทึกครั้งเดียวใช้ได้ทุกรอบต่อไป</strong>
          </p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-sm px-3 py-1.5 border border-slate-300 rounded whitespace-nowrap"
        >
          {open ? "ซ่อน" : "จัดการทะเบียน"}
        </button>
      </div>

      {open && (
        <>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-100">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="ค้นหาเลขบัญชี / เลขสมาชิก / ชื่อ"
              className="text-sm border border-slate-300 rounded px-3 py-1.5 w-64"
            />
            <span className="text-slate-300">|</span>
            <input
              type="text"
              value={newAccount}
              onChange={(e) => setNewAccount(e.target.value)}
              placeholder="เลขบัญชี"
              className="text-sm border border-slate-300 rounded px-3 py-1.5 w-44 font-mono"
            />
            <input
              type="text"
              value={newMember}
              onChange={(e) => setNewMember(e.target.value)}
              placeholder="เลขสมาชิก"
              className="text-sm border border-slate-300 rounded px-3 py-1.5 w-36"
            />
            <button
              onClick={addEntry}
              disabled={busy || !newAccount.trim() || !newMember.trim()}
              className="text-sm px-3 py-1.5 bg-slate-900 text-white rounded disabled:opacity-50"
            >
              เพิ่ม
            </button>
            {unknownMembers > 0 && (
              <span className="text-xs text-amber-700">
                มี {unknownMembers} รายการที่เลขสมาชิกไม่มีในทะเบียนสมาชิก — อาจพิมพ์ผิด
              </span>
            )}
          </div>

          {/* Bulk import. The cooperative already keeps this mapping in a
              file; before this the only way in was one row at a time. */}
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm px-3 py-1.5 border border-slate-300 bg-white rounded cursor-pointer hover:bg-slate-50">
                นำเข้าจากไฟล์ Excel
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={importFile}
                  disabled={busy}
                  className="hidden"
                />
              </label>
              <p className="text-xs text-slate-500">
                ไฟล์ที่มีคอลัมน์ <strong>เลขสมาชิก</strong> และ <strong>เลขบัญชี</strong> —
                อยู่คอลัมน์ไหนก็ได้ ระบบหาจากชื่อหัวตารางเอง ·{" "}
                <strong>เพิ่มทับของเดิม ไม่ลบ</strong> เลขบัญชีที่ผูกไว้แล้วและไม่มีในไฟล์จะไม่ถูกแตะ
              </p>
            </div>

            {importResult && (
              <div className="mt-3 text-xs space-y-1">
                {importResult.imported !== undefined && (
                  <p className="text-green-700">
                    นำเข้า {importResult.imported} เลขบัญชี — เพิ่มใหม่ {importResult.added}
                    {(importResult.repointed ?? 0) > 0 && (
                      <span className="text-amber-700">
                        {" "}
                        · <strong>ย้ายเจ้าของ {importResult.repointed}</strong>
                      </span>
                    )}{" "}
                    · เหมือนเดิม {importResult.unchanged}
                    {(importResult.roundsRematched ?? 0) > 0 &&
                      ` · คำนวณรอบเทียบ Statement ใหม่ ${importResult.roundsRematched} รอบ`}
                  </p>
                )}

                {(importResult.conflictCount ?? 0) > 0 && (
                  <div className="text-red-700">
                    <p>
                      เลขบัญชีที่ผูกกับสมาชิกคนละคนในไฟล์เดียวกัน ({importResult.conflictCount}):
                    </p>
                    <ul className="ml-4 list-disc">
                      {importResult.conflicts?.map((c) => (
                        <li key={c.accountNumber} className="font-mono">
                          {c.accountNumber} → {c.memberNumbers.join(", ")}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {(importResult.problemCount ?? 0) > 0 && (
                  <details className="text-amber-700">
                    <summary className="cursor-pointer">
                      แถวที่ข้ามไป {importResult.problemCount} แถว (กดดู)
                    </summary>
                    <ul className="ml-4 mt-1 list-disc">
                      {importResult.problems?.map((p) => (
                        <li key={p.rowNumber}>
                          แถวราวๆ {p.rowNumber}: {p.reason}
                        </li>
                      ))}
                      {(importResult.problemCount ?? 0) > (importResult.problems?.length ?? 0) && (
                        <li className="text-slate-500">
                          และอีก{" "}
                          {(importResult.problemCount ?? 0) - (importResult.problems?.length ?? 0)}{" "}
                          แถว
                        </li>
                      )}
                    </ul>
                  </details>
                )}

                {(importResult.unknownMemberCount ?? 0) > 0 && (
                  <p className="text-amber-700">
                    เลขสมาชิกที่ไม่มีในทะเบียนสมาชิก {importResult.unknownMemberCount} เลข
                    (บันทึกให้แล้ว แต่ควรตรวจว่าพิมพ์ถูก):{" "}
                    <span className="font-mono">{importResult.unknownMembers?.join(", ")}</span>
                  </p>
                )}
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2 mx-4 mt-3">{error}</p>
          )}

          {loading ? (
            <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
          ) : entries.length === 0 ? (
            <p className="text-slate-500 text-sm py-8 text-center">
              {search
                ? "ไม่พบรายการที่ตรงกับคำค้นหา"
                : 'ยังไม่มีเลขบัญชีในทะเบียน — จะถูกเพิ่มให้เองเมื่อกด "ระบุเจ้าของ" ในตารางเงินที่ไม่พบเจ้าของ'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead className="bg-slate-100 text-slate-600 text-left">
                  <tr>
                    <th className="px-4 py-2">เลขบัญชี</th>
                    <th className="px-4 py-2">เลขสมาชิก</th>
                    <th className="px-4 py-2">ชื่อ-สกุล</th>
                    <th className="px-4 py-2">สังกัด</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-mono text-xs">{entry.accountNumber}</td>
                      <td className="px-4 py-2">
                        {editingId === entry.id ? (
                          <input
                            value={editMember}
                            onChange={(e) => setEditMember(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit(entry);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            autoFocus
                            className="border border-slate-300 rounded px-2 py-1 text-sm w-32"
                          />
                        ) : (
                          <>
                            {entry.memberNumber}
                            {!entry.inRoster && (
                              <span className="text-xs text-amber-700"> · ไม่พบในทะเบียน</span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-2">{entry.memberName ?? "—"}</td>
                      <td className="px-4 py-2 text-slate-500">{entry.unitName ?? "—"}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-right space-x-3">
                        {editingId === entry.id ? (
                          <>
                            <button
                              onClick={() => saveEdit(entry)}
                              disabled={busy}
                              className="text-slate-900 hover:underline disabled:opacity-50"
                            >
                              บันทึก
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="text-slate-500 hover:underline"
                            >
                              ยกเลิก
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => {
                                setEditingId(entry.id);
                                setEditMember(entry.memberNumber);
                              }}
                              className="text-slate-600 hover:underline"
                            >
                              แก้ไข
                            </button>
                            <button
                              onClick={() => setPendingDelete(entry)}
                              className="text-red-600 hover:underline"
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
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="ลบเลขบัญชีนี้ออกจากทะเบียน?"
        description={
          pendingDelete
            ? `${pendingDelete.accountNumber} → ${pendingDelete.memberNumber} ` +
              `${pendingDelete.memberName ?? ""} — รอบที่เทียบไปแล้วไม่ถูกแตะต้อง ` +
              `แต่รอบต่อไปเงินจากบัญชีนี้จะกลับไปอยู่ใน "โอนเข้ามาแต่ไม่พบเจ้าของ" อีก`
            : undefined
        }
        confirmLabel="ลบ"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
