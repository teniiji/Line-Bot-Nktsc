"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PanelHelp from "@/components/PanelHelp";

interface ControlUnit {
  code: string;
  name: string;
  note: string | null;
  updatedAt: string | null;
}

// The cooperative's หน่วยคุม, where staff can maintain them.
//
// These names are what the เทียบ Statement filter offers — "75 สมาชิกปกติ
// ย้ายไปต่างจังหวัด เขต 1" rather than "หน่วยคุม 75" — and the list used to
// live in the code, so a unit added in October had no name until somebody
// deployed. It is the cooperative's own reference data.
export default function ControlUnitsPanel() {
  const [units, setUnits] = useState<ControlUnit[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which row is being renamed, and what into — one at a time, because the
  // save is per unit and a screen full of half-typed names is a screen
  // nobody can tell the saved rows from.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/control-units");
    if (!res.ok) return;
    const body = await res.json();
    setUnits(body.data ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/control-units", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "อัปโหลดไม่สำเร็จ");
        return;
      }
      setNotice(
        `อ่านได้ ${body.total} หน่วย: เพิ่มใหม่ ${body.added} · แก้ชื่อ ${body.renamed} · เหมือนเดิม ${body.unchanged}` +
          (body.untouched > 0
            ? ` · อีก ${body.untouched} หน่วยที่ไฟล์นี้ไม่ได้พูดถึง คงไว้ตามเดิม`
            : "") +
          (body.skippedRows > 0 ? ` · ข้าม ${body.skippedRows} แถวที่อ่านไม่ออก` : "")
      );
      await load();
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const rename = async (code: string) => {
    const name = draft.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/control-units", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, name }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "บันทึกไม่สำเร็จ");
        return;
      }
      setNotice(`บันทึกชื่อหน่วยคุม ${code} แล้ว`);
      setEditing(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const needle = search.trim().toLowerCase();
  const shown = needle
    ? units.filter((u) => `${u.code} ${u.name}`.toLowerCase().includes(needle))
    : units;

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="font-semibold">ชื่อหน่วยคุม</h2>
        <PanelHelp summary="รหัสและชื่อหน่วยคุมที่ใช้ในตัวกรองของแท็บเทียบ Statement — แก้ได้เองที่นี่">
          <p>
            ชื่อพวกนี้คือสิ่งที่ขึ้นในตัวกรองหน่วยคุม (เช่น{" "}
            <strong>75 สมาชิกปกติย้ายไปต่างจังหวัด เขต 1</strong>) และในคอลัมน์
            &quot;ชื่อหน่วยคุม&quot; ของไฟล์ CSV ที่ส่งออก
          </p>
          <p className="mt-2">
            <strong>อัปโหลดไฟล์</strong> ต้องเป็น Excel 2 คอลัมน์ —{" "}
            <strong>A รหัสหน่วยคุม</strong> (ตัวเลข) และ <strong>B ชื่อหน่วยคุม</strong>{" "}
            มีหัวตารางหรือไม่มีก็ได้
          </p>
          <p className="mt-2">
            ไฟล์ที่อัป <strong>เพิ่มและแก้ชื่อเท่านั้น ไม่ลบหน่วยที่ไม่ได้อยู่ในไฟล์</strong> —
            อัปแค่หน่วยเดียวเพื่อแก้ชื่อก็ได้ ที่เหลือคงไว้ตามเดิม
          </p>
          <p className="mt-2">
            หน่วยที่ยังไม่มีชื่อในนี้ <strong>ใช้งานได้ตามปกติ</strong> — ตัวกรองจะขึ้นเป็น
            &quot;หน่วยคุม 55&quot; สมาชิกในหน่วยนั้นไม่หายไปไหน
          </p>
        </PanelHelp>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-100 text-sm">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหารหัสหรือชื่อหน่วยคุม"
          className="border border-slate-300 rounded-md px-3 py-1.5 w-64"
        />
        <span className="text-slate-500">
          {needle ? `พบ ${shown.length} จาก ${units.length} หน่วย` : `ทั้งหมด ${units.length} หน่วย`}
        </span>
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
          }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="ml-auto border border-slate-300 rounded px-3 py-1.5 font-medium disabled:opacity-40"
        >
          อัปโหลดไฟล์รายชื่อหน่วยคุม
        </button>
      </div>

      {error && <p className="px-4 py-2 text-sm text-red-700 bg-red-50">{error}</p>}
      {notice && <p className="px-4 py-2 text-sm text-slate-700 bg-slate-50">{notice}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600 text-left text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2.5 font-semibold w-24">รหัส</th>
              <th className="px-4 py-2.5 font-semibold">ชื่อหน่วยคุม</th>
              <th className="px-4 py-2.5 font-semibold w-32"></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((unit) => (
              <tr key={unit.code} className="border-t border-slate-100">
                <td className="px-4 py-2 num">{unit.code}</td>
                <td className="px-4 py-2">
                  {editing === unit.code ? (
                    <input
                      type="text"
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") rename(unit.code);
                        if (e.key === "Escape") setEditing(null);
                      }}
                      className="border border-slate-300 rounded px-2 py-1 w-full max-w-md"
                    />
                  ) : (
                    unit.name
                  )}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {editing === unit.code ? (
                    <>
                      <button
                        type="button"
                        onClick={() => rename(unit.code)}
                        disabled={busy}
                        className="text-slate-900 font-medium hover:underline disabled:opacity-40"
                      >
                        บันทึก
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="text-slate-500 hover:underline ml-3"
                      >
                        ยกเลิก
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(unit.code);
                        setDraft(unit.name);
                      }}
                      className="text-slate-500 hover:underline"
                    >
                      แก้ชื่อ
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                  {needle ? `ไม่พบ "${search}"` : "ยังไม่มีรายชื่อหน่วยคุม — อัปโหลดไฟล์ได้เลย"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
