"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

// Members who moved to another province, and the office there that deducts
// their pay — imported from the cooperative's own list (see
// lib/outOfProvinceSheet.ts).

interface Member {
  id: string;
  memberNumber: string;
  name: string | null;
  inRoster: boolean;
  rosterUnit: string | null;
  deductingUnit: string;
  originalUnit: string | null;
  note: string | null;
}

interface ImportResult {
  imported: number;
  added: number;
  moved: number;
  unchanged: number;
  unconfirmed: number;
  addedToUnits: number;
  problemCount: number;
  problems: { rowNumber: number; reason: string }[];
  unknownMemberCount: number;
  unknownMembers: string[];
}

export default function OutOfProvincePanel() {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [units, setUnits] = useState<
    { name: string; count: number; linkedTo: { id: string; name: string } | null }[]
  >([]);
  const [unitFilter, setUnitFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Member | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/out-of-province-members");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "โหลดรายชื่อไม่สำเร็จ");
        return;
      }
      setMembers(body.data ?? []);
      setUnits(body.units ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    setErrorDetails([]);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/out-of-province-members/import", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "นำเข้าไม่สำเร็จ");
        setErrorDetails([
          ...(body.conflicts ?? []).map(
            (c: { memberNumber: string; units: string[] }) => `${c.memberNumber}: ${c.units.join(" / ")}`
          ),
          ...(body.problems ?? []).map((p: { rowNumber: number; reason: string }) => `แถว ${p.rowNumber}: ${p.reason}`),
        ]);
        return;
      }
      setResult(body);
      await load();
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const remove = async (member: Member) => {
    setPendingDelete(null);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/out-of-province-members/${member.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "ลบไม่สำเร็จ");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const q = search.trim().toLowerCase();
  const shown = members.filter(
    (m) =>
      (!unitFilter || m.deductingUnit === unitFilter) &&
      (!q ||
        m.memberNumber.includes(q) ||
        (m.name ?? "").toLowerCase().includes(q) ||
        m.deductingUnit.toLowerCase().includes(q))
  );

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <div>
          <h2 className="font-semibold">🗺️ สมาชิกย้ายไปต่างจังหวัด</h2>
          <p className="text-xs text-slate-500 mt-1">
            สมาชิกที่ย้ายไปรับราชการต่างจังหวัด และ<strong>หน่วยงานหักเงิน</strong>ที่นั่น (เช่น อุดรธานี 1,
            ศธจ.นนทบุรี) ซึ่งหักเงินเดือนแล้วโอนมาให้สหกรณ์ · นำเข้าจากไฟล์ Excel ที่มีคอลัมน์{" "}
            <strong>เลขสมาชิก</strong> และ <strong>หน่วยงานหักเงิน</strong> — ถ้าไฟล์มีคอลัมน์{" "}
            <strong>ยืนยัน</strong> จะนำเข้าเฉพาะแถวที่ติ๊ก ✓ · ผูกหน่วยงานหักเงินกับชื่อหน่วยงานในสเตทเมนต์ได้ที่กล่อง
            "หน่วยงานที่โอนแทนสมาชิก" (🔗 = ผูกแล้ว)
          </p>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-sm px-3 py-1.5 border border-slate-300 rounded whitespace-nowrap shrink-0"
        >
          {open ? "ซ่อน" : "ดูรายชื่อ / นำเข้า"}
        </button>
      </div>

      {open && (
        <div className="px-4 py-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label
              className={`text-sm px-3 py-1.5 rounded border border-slate-300 cursor-pointer hover:bg-slate-50 ${
                busy ? "opacity-50 pointer-events-none" : ""
              }`}
            >
              {busy ? "กำลังนำเข้า…" : "📥 นำเข้าจากไฟล์ Excel"}
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
            </label>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาเลขสมาชิก ชื่อ หรือหน่วยงาน"
              className="border border-slate-300 rounded px-3 py-1.5 text-sm w-full sm:w-72"
            />
            <span className="text-xs text-slate-500">
              {loading ? "กำลังโหลด…" : `${members.length} คน · ${units.length} หน่วยงาน`}
            </span>
          </div>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 rounded px-3 py-2">
              {error}
              {errorDetails.length > 0 && (
                <ul className="mt-1 text-xs list-disc pl-5">
                  {errorDetails.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {result && (
            <div className="text-sm text-green-800 bg-green-50 rounded px-3 py-2">
              นำเข้าแล้ว {result.imported} คน — เพิ่มใหม่ {result.added} · ย้ายหน่วยงาน {result.moved} · เหมือนเดิม{" "}
              {result.unchanged}
              {result.addedToUnits > 0 && (
                <span> · เพิ่มเข้าหน่วยงานที่ผูกไว้ {result.addedToUnits} คน</span>
              )}
              {result.unconfirmed > 0 && (
                <span className="text-slate-600"> · ข้าม {result.unconfirmed} แถวที่ยังไม่ติ๊กยืนยัน</span>
              )}
              {result.problemCount > 0 && (
                <div className="mt-1 text-amber-800">
                  ⚠️ ข้าม {result.problemCount} แถวที่ใช้ไม่ได้:
                  <ul className="text-xs list-disc pl-5">
                    {result.problems.map((p) => (
                      <li key={p.rowNumber}>
                        แถว {p.rowNumber}: {p.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.unknownMemberCount > 0 && (
                <div className="mt-1 text-amber-800">
                  ⚠️ {result.unknownMemberCount} เลขไม่พบในทะเบียนสมาชิก (นำเข้าแล้ว แต่ตรวจว่าพิมพ์ถูกไหม):{" "}
                  {result.unknownMembers.join(", ")}
                </div>
              )}
            </div>
          )}

          {units.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setUnitFilter(null)}
                className={`text-xs px-2 py-1 rounded-full border ${
                  unitFilter === null ? "bg-slate-800 text-white border-slate-800" : "border-slate-300"
                }`}
              >
                ทุกหน่วยงาน {members.length}
              </button>
              {units.map((u) => (
                <button
                  key={u.name}
                  onClick={() => setUnitFilter(unitFilter === u.name ? null : u.name)}
                  className={`text-xs px-2 py-1 rounded-full border ${
                    unitFilter === u.name ? "bg-slate-800 text-white border-slate-800" : "border-slate-300"
                  }`}
                >
                  {u.name} {u.count}
                  {u.linkedTo && (
                    <span title={`ผูกกับหน่วยงานในสเตทเมนต์: ${u.linkedTo.name}`}> 🔗</span>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="overflow-auto max-h-[480px] border border-slate-200 rounded">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-left text-xs sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-semibold">เลขสมาชิก</th>
                  <th className="px-3 py-2 font-semibold">ชื่อ</th>
                  <th className="px-3 py-2 font-semibold">หน่วยงานหักเงิน</th>
                  <th className="px-3 py-2 font-semibold">สังกัดเดิม</th>
                  <th className="px-3 py-2 font-semibold">หมายเหตุ</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-slate-400">
                      {members.length === 0 ? "ยังไม่มีรายชื่อ — นำเข้าจากไฟล์ Excel" : "ไม่พบรายชื่อที่ค้นหา"}
                    </td>
                  </tr>
                )}
                {shown.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-1.5 num">{m.memberNumber}</td>
                    <td className="px-3 py-1.5">
                      {m.name ?? <span className="text-slate-400">—</span>}
                      {!m.inRoster && (
                        <span className="ml-1 text-xs text-amber-700" title="ไม่พบเลขนี้ในทะเบียนสมาชิก">
                          ⚠️ ไม่อยู่ในทะเบียน
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{m.deductingUnit}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-slate-500">{m.originalUnit ?? "—"}</td>
                    <td className="px-3 py-1.5 text-xs text-slate-500 max-w-[220px] truncate" title={m.note ?? ""}>
                      {m.note ?? ""}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        onClick={() => setPendingDelete(m)}
                        disabled={busy}
                        className="text-xs text-red-700 hover:underline disabled:opacity-40"
                      >
                        เอาออก
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`เอา ${pendingDelete?.memberNumber ?? ""} ออกจากรายชื่อต่างจังหวัด?`}
        description={
          pendingDelete
            ? `${pendingDelete.name ?? ""} · ${pendingDelete.deductingUnit} — ใช้เมื่อสมาชิกย้ายกลับหรือนำเข้าผิดคน นำเข้าใหม่ได้เสมอ`
            : undefined
        }
        confirmLabel="เอาออก"
        onConfirm={() => pendingDelete && remove(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
