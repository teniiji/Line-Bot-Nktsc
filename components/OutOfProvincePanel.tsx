"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { sortRows, type SortDir } from "@/lib/tableSort";

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
  linkedTo: LinkedUnit | null;
  onLinkedUnit: boolean;
}

// The statement unit (หน่วยงานที่โอนแทนสมาชิก) an office is linked to.
interface LinkedUnit {
  id: string;
  name: string;
  key: string;
}

interface ImportResult {
  imported: number;
  added: number;
  moved: number;
  unchanged: number;
  unconfirmed: number;
  addedToUnits: number;
  // Units linked to their office by this import (autoLinkOffices).
  unitsLinked?: number;
  problemCount: number;
  problems: { rowNumber: number; reason: string }[];
  unknownMemberCount: number;
  unknownMembers: string[];
}

const ORIGINAL_UNITS = ["ต.1", "ต.2", "ต.3", "ต.4"];

type MemberSortKey = "memberNumber" | "name" | "deductingUnit" | "originalUnit" | "linked" | "note";
type OfficeSortKey = "name" | "count" | "linked";

// A column heading that sorts the table: click once ascending, again
// descending.
function SortHeader<K extends string>({
  label,
  column,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  column: K;
  sort: { key: K; dir: SortDir } | null;
  onSort: (key: K) => void;
  align?: "left" | "right";
}) {
  const active = sort?.key === column;
  return (
    <th className={`px-3 py-2 font-semibold ${align === "right" ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-1 hover:text-slate-900 ${active ? "text-slate-900" : ""}`}
        title="กดเพื่อเรียงตามหัวข้อนี้ (กดอีกครั้งเพื่อเรียงกลับ)"
      >
        {label}
        <span className="text-[10px]">{active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}

const nextSort = <K extends string>(current: { key: K; dir: SortDir } | null, key: K) =>
  current?.key === key ? { key, dir: current.dir === "asc" ? ("desc" as const) : ("asc" as const) } : { key, dir: "asc" as const };

export default function OutOfProvincePanel() {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [units, setUnits] = useState<{ name: string; count: number; linkedTo: LinkedUnit | null }[]>([]);
  const [view, setView] = useState<"members" | "offices">("members");
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);
  const [unitFilter, setUnitFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Member | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const emptyDraft = { memberNumber: "", deductingUnit: "", originalUnit: "", note: "" };
  const [draft, setDraft] = useState(emptyDraft);
  const [editing, setEditing] = useState<{
    id: string;
    deductingUnit: string;
    originalUnit: string;
    note: string;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [memberSort, setMemberSort] = useState<{ key: MemberSortKey; dir: SortDir } | null>(null);
  const [officeSort, setOfficeSort] = useState<{ key: OfficeSortKey; dir: SortDir } | null>(null);
  // Statement units (หน่วยงานที่โอนแทนสมาชิก) an office can be linked to.
  const [payers, setPayers] = useState<{ id: string; name: string; key: string }[]>([]);
  const [linkPick, setLinkPick] = useState<Record<string, string>>({});

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
      const payerRes = await fetch("/api/unit-payers");
      if (payerRes.ok) {
        const payerBody = await payerRes.json().catch(() => ({}));
        setPayers(
          (payerBody.data ?? []).map((p: { id: string; name: string; key: string }) => ({
            id: p.id,
            name: p.name,
            key: p.key,
          }))
        );
      }
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

  // Add one member by hand, or save a row's edits — same busy/error handling.
  const send = async (url: string, method: "POST" | "PATCH", body: unknown) => {
    setBusy(true);
    setError(null);
    setErrorDetails([]);
    setNotice(null);
    setResult(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "บันทึกไม่สำเร็จ");
        return null;
      }
      await load();
      return json;
    } finally {
      setBusy(false);
    }
  };

  const addOne = async () => {
    const json = await send("/api/out-of-province-members", "POST", draft);
    if (!json) return;
    setNotice(
      `เพิ่ม ${draft.memberNumber.trim()} ${json.name ?? ""} (${draft.deductingUnit.trim()}) แล้ว` +
        (json.addedToUnits > 0 ? " — เพิ่มเข้าหน่วยงานที่ผูกไว้ด้วย" : "") +
        (json.inRoster ? "" : " — ⚠️ ไม่พบเลขนี้ในทะเบียนสมาชิก ตรวจว่าพิมพ์ถูกไหม")
    );
    setDraft(emptyDraft);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const json = await send(`/api/out-of-province-members/${editing.id}`, "PATCH", {
      deductingUnit: editing.deductingUnit,
      originalUnit: editing.originalUnit,
      note: editing.note,
    });
    if (!json) return;
    setNotice(json.moved ? "บันทึกแล้ว — ย้ายหน่วยงานหักเงินแล้ว (ย้ายตามในหน่วยงานที่ผูกไว้ด้วย)" : "บันทึกแล้ว");
    setEditing(null);
  };

  // Link an office to a statement unit from here, the same call the unit
  // panel makes (lib/unitPayerOffices.ts).
  const linkOffice = async (office: string, payerId: string) => {
    const json = await send(`/api/unit-payers/${payerId}/offices`, "POST", { office });
    if (!json) return;
    const payer = payers.find((p) => p.id === payerId);
    setNotice(`ผูก "${office}" กับ ${payer?.name ?? "หน่วยงาน"} แล้ว — เพิ่มสมาชิก ${json.added} คนเข้าหน่วยงานนั้น`);
    setLinkPick((prev) => ({ ...prev, [office]: "" }));
  };

  const unlinkOffice = async (office: string, payerId: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/unit-payers/${payerId}/offices?office=${encodeURIComponent(office)}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "ยกเลิกการผูกไม่สำเร็จ");
        return;
      }
      setNotice(`ยกเลิกการผูก "${office}" แล้ว (คนที่เคยบันทึกยอดไว้ยังอยู่ในหน่วยงานนั้น)`);
      await load();
    } finally {
      setBusy(false);
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
  const filtered = members.filter(
    (m) =>
      (!unitFilter || m.deductingUnit === unitFilter) &&
      (!unlinkedOnly || !m.linkedTo) &&
      (!q ||
        m.memberNumber.includes(q) ||
        (m.name ?? "").toLowerCase().includes(q) ||
        m.deductingUnit.toLowerCase().includes(q))
  );
  const shown = memberSort
    ? sortRows(
        filtered,
        (m) =>
          memberSort.key === "linked"
            ? m.linkedTo?.name ?? null
            : memberSort.key === "name"
              ? m.name
              : m[memberSort.key],
        memberSort.dir
      )
    : filtered;

  const linkedUnits = units.filter((u) => u.linkedTo);
  const unlinkedUnits = units.filter((u) => !u.linkedTo);
  const countOf = (list: typeof units) => list.reduce((n, u) => n + u.count, 0);
  const officesFiltered = units
    .filter((u) => (!unlinkedOnly || !u.linkedTo) && (!q || u.name.toLowerCase().includes(q) || (u.linkedTo?.name ?? "").toLowerCase().includes(q)))
    .sort((a, b) => Number(!!a.linkedTo) - Number(!!b.linkedTo) || b.count - a.count || a.name.localeCompare(b.name, "th"));
  const shownOffices = officeSort
    ? sortRows(
        officesFiltered,
        (u) => (officeSort.key === "linked" ? u.linkedTo?.name ?? null : u[officeSort.key]),
        officeSort.dir
      )
    : officesFiltered;

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <div>
          <h2 className="font-semibold">🗺️ สมาชิกย้ายไปต่างจังหวัด</h2>
          <p className="text-xs text-slate-500 mt-1">
            สมาชิกที่ย้ายไปรับราชการต่างจังหวัด และ<strong>หน่วยงานหักเงิน</strong>ที่นั่น (เช่น อุดรธานี 1,
            ศธจ.นนทบุรี) ซึ่งหักเงินเดือนแล้วโอนมาให้สหกรณ์ · นำเข้าจากไฟล์ Excel ที่มีคอลัมน์{" "}
            <strong>เลขสมาชิก</strong> และ <strong>หน่วยงานหักเงิน</strong> — ถ้าไฟล์มีคอลัมน์{" "}
            <strong>ยืนยัน</strong> จะนำเข้าเฉพาะแถวที่ติ๊ก ✓ · ผูกหน่วยงานหักเงินกับหน่วยงานในสเตทเมนต์ได้ที่มุมมอง
            "🔗 ตามหน่วยงาน" ข้างล่าง หรือที่กล่อง "หน่วยงานที่โอนแทนสมาชิก" · กดหัวตารางเพื่อเรียงลำดับ
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
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className={`text-sm px-3 py-1.5 rounded border ${
                adding ? "border-slate-800 bg-slate-800 text-white" : "border-slate-300 hover:bg-slate-50"
              }`}
            >
              ➕ เพิ่มรายคน
            </button>
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

          <datalist id="oop-units">
            {units.map((u) => (
              <option key={u.name} value={u.name} />
            ))}
          </datalist>

          {adding && (
            <div className="flex flex-wrap items-end gap-2 bg-slate-50 rounded px-3 py-2 text-sm">
              <label className="flex flex-col text-xs text-slate-500">
                เลขสมาชิก
                <input
                  value={draft.memberNumber}
                  onChange={(e) => setDraft({ ...draft, memberNumber: e.target.value })}
                  inputMode="numeric"
                  className="border border-slate-300 rounded px-2 py-1 text-sm w-28 text-slate-900"
                />
              </label>
              <label className="flex flex-col text-xs text-slate-500">
                หน่วยงานหักเงิน
                <input
                  value={draft.deductingUnit}
                  onChange={(e) => setDraft({ ...draft, deductingUnit: e.target.value })}
                  list="oop-units"
                  placeholder="เช่น อุดรธานี 1"
                  className="border border-slate-300 rounded px-2 py-1 text-sm w-56 text-slate-900"
                />
              </label>
              <label className="flex flex-col text-xs text-slate-500">
                สังกัดเดิม
                <select
                  value={draft.originalUnit}
                  onChange={(e) => setDraft({ ...draft, originalUnit: e.target.value })}
                  className="border border-slate-300 rounded px-2 py-1 text-sm text-slate-900"
                >
                  <option value="">—</option>
                  {ORIGINAL_UNITS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col text-xs text-slate-500 grow">
                หมายเหตุ
                <input
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  className="border border-slate-300 rounded px-2 py-1 text-sm min-w-[180px] text-slate-900"
                />
              </label>
              <button
                type="button"
                onClick={addOne}
                disabled={busy || !draft.memberNumber.trim() || !draft.deductingUnit.trim()}
                className="text-sm text-white bg-slate-900 rounded px-3 py-1.5 disabled:opacity-50"
              >
                เพิ่ม
              </button>
            </div>
          )}

          {notice && <p className="text-sm text-green-700 bg-green-50 rounded px-3 py-2">{notice}</p>}

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
              {(result.unitsLinked ?? 0) > 0 && (
                <span> · ผูกหน่วยงานที่โอนเงินให้อัตโนมัติ {result.unitsLinked} หน่วย</span>
              )}
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
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex rounded border border-slate-300 overflow-hidden">
                <button
                  onClick={() => setView("members")}
                  className={`px-3 py-1 ${view === "members" ? "bg-slate-800 text-white" : "hover:bg-slate-50"}`}
                >
                  👥 รายชื่อ
                </button>
                <button
                  onClick={() => setView("offices")}
                  className={`px-3 py-1 border-l border-slate-300 ${view === "offices" ? "bg-slate-800 text-white" : "hover:bg-slate-50"}`}
                >
                  🔗 ตามหน่วยงาน
                </button>
              </span>
              <span className="text-xs text-slate-600">
                ผูกแล้ว <strong className="text-violet-700">{linkedUnits.length}</strong> หน่วยงาน (
                {countOf(linkedUnits)} คน) · ยังไม่ผูก <strong className="text-amber-700">{unlinkedUnits.length}</strong>{" "}
                หน่วยงาน ({countOf(unlinkedUnits)} คน)
              </span>
              <label className="inline-flex items-center gap-1 text-xs text-slate-600">
                <input type="checkbox" checked={unlinkedOnly} onChange={(e) => setUnlinkedOnly(e.target.checked)} />
                เฉพาะที่ยังไม่ผูก
              </label>
            </div>
          )}

          {view === "offices" && units.length > 0 && (
            <div className="overflow-auto max-h-[480px] border border-slate-200 rounded">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-left text-xs sticky top-0 z-10">
                  <tr>
                    <SortHeader label="หน่วยงานหักเงิน (ต่างจังหวัด)" column="name" sort={officeSort} onSort={(k) => setOfficeSort(nextSort(officeSort, k))} />
                    <SortHeader label="สมาชิก" column="count" align="right" sort={officeSort} onSort={(k) => setOfficeSort(nextSort(officeSort, k))} />
                    <SortHeader label="ผูกกับหน่วยงานในสเตทเมนต์" column="linked" sort={officeSort} onSort={(k) => setOfficeSort(nextSort(officeSort, k))} />
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {shownOffices.map((u) => (
                    <tr key={u.name} className="border-t border-slate-100 hover:bg-slate-50 align-top">
                      <td className="px-3 py-1.5">{u.name}</td>
                      <td className="px-3 py-1.5 num text-right">{u.count}</td>
                      <td className="px-3 py-1.5">
                        {u.linkedTo ? (
                          <>
                            <span className="text-violet-700">🔗 {u.linkedTo.name}</span>
                            <button
                              type="button"
                              onClick={() => unlinkOffice(u.name, u.linkedTo!.id)}
                              disabled={busy}
                              className="ml-2 text-xs text-slate-400 hover:text-red-700 disabled:opacity-40"
                              title="ยกเลิกการผูก — สมาชิกที่มาจากการผูกจะถูกเอาออกจากหน่วยงานนั้น (คนที่เคยบันทึกยอดไว้ยังอยู่)"
                            >
                              ✕ ยกเลิก
                            </button>
                            <span className="block font-mono text-[11px] text-slate-400">{u.linkedTo.key}</span>
                          </>
                        ) : payers.length === 0 ? (
                          <span
                            className="text-amber-700 text-xs"
                            title='ยังไม่มีหน่วยงานในสเตทเมนต์ — เพิ่มได้ที่กล่อง "หน่วยงานที่โอนแทนสมาชิก" หรือกด "เพิ่มหน่วยงาน" ที่บรรทัดของหน่วยงานในหน้าเงินเข้าประจำวัน'
                          >
                            — ยังไม่ผูก (ยังไม่มีหน่วยงานในสเตทเมนต์ให้เลือก)
                          </span>
                        ) : (
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <select
                              value={linkPick[u.name] ?? ""}
                              onChange={(e) => setLinkPick((prev) => ({ ...prev, [u.name]: e.target.value }))}
                              className="border border-amber-300 rounded px-1.5 py-0.5 text-xs max-w-[280px]"
                            >
                              <option value="">— ยังไม่ผูก · เลือกหน่วยงานในสเตทเมนต์ —</option>
                              {payers.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} ({p.key})
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => linkOffice(u.name, linkPick[u.name])}
                              disabled={busy || !linkPick[u.name]}
                              className="text-xs text-white bg-violet-700 rounded px-2 py-0.5 disabled:opacity-40"
                            >
                              ผูก
                            </button>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          onClick={() => {
                            setUnitFilter(u.name);
                            setView("members");
                          }}
                          className="text-xs text-slate-700 hover:underline"
                        >
                          ดูรายชื่อ
                        </button>
                      </td>
                    </tr>
                  ))}
                  {shownOffices.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-center text-slate-400">
                        ไม่พบหน่วยงานที่ค้นหา
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {view === "members" && units.length > 0 && (
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

          {view === "members" && (
          <div className="overflow-auto max-h-[480px] border border-slate-200 rounded">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-left text-xs sticky top-0 z-10">
                <tr>
                  <SortHeader label="เลขสมาชิก" column="memberNumber" sort={memberSort} onSort={(k) => setMemberSort(nextSort(memberSort, k))} />
                  <SortHeader label="ชื่อ" column="name" sort={memberSort} onSort={(k) => setMemberSort(nextSort(memberSort, k))} />
                  <SortHeader label="หน่วยงานหักเงิน" column="deductingUnit" sort={memberSort} onSort={(k) => setMemberSort(nextSort(memberSort, k))} />
                  <SortHeader label="สังกัดเดิม" column="originalUnit" sort={memberSort} onSort={(k) => setMemberSort(nextSort(memberSort, k))} />
                  <SortHeader label="ผูกกับหน่วยงานในสเตทเมนต์" column="linked" sort={memberSort} onSort={(k) => setMemberSort(nextSort(memberSort, k))} />
                  <SortHeader label="หมายเหตุ" column="note" sort={memberSort} onSort={(k) => setMemberSort(nextSort(memberSort, k))} />
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-slate-400">
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
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {editing?.id === m.id ? (
                        <input
                          value={editing.deductingUnit}
                          onChange={(e) => setEditing({ ...editing, deductingUnit: e.target.value })}
                          list="oop-units"
                          className="border border-slate-300 rounded px-2 py-0.5 text-sm w-48"
                          autoFocus
                        />
                      ) : (
                        m.deductingUnit
                      )}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-slate-500">
                      {editing?.id === m.id ? (
                        <select
                          value={editing.originalUnit}
                          onChange={(e) => setEditing({ ...editing, originalUnit: e.target.value })}
                          className="border border-slate-300 rounded px-1.5 py-0.5 text-sm text-slate-900"
                        >
                          <option value="">—</option>
                          {[...new Set([...ORIGINAL_UNITS, ...(m.originalUnit ? [m.originalUnit] : [])])].map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        m.originalUnit ?? "—"
                      )}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-xs">
                      {m.linkedTo ? (
                        <span className="text-violet-700" title={m.linkedTo.key}>
                          🔗 {m.linkedTo.name}
                          {!m.onLinkedUnit && (
                            <span className="text-amber-700" title="ยังไม่อยู่ในรายชื่อของหน่วยงานนั้น">
                              {" "}
                              ⚠️
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-400">— ยังไม่ผูก</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-slate-500 max-w-[220px] truncate" title={m.note ?? ""}>
                      {editing?.id === m.id ? (
                        <input
                          value={editing.note}
                          onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                          className="border border-slate-300 rounded px-2 py-0.5 text-sm w-full min-w-[160px] text-slate-900"
                        />
                      ) : (
                        m.note ?? ""
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">
                      {editing?.id === m.id ? (
                        <span className="inline-flex gap-2">
                          <button
                            onClick={saveEdit}
                            disabled={busy || !editing.deductingUnit.trim()}
                            className="text-xs text-white bg-slate-900 rounded px-2 py-0.5 disabled:opacity-50"
                          >
                            บันทึก
                          </button>
                          <button onClick={() => setEditing(null)} className="text-xs text-slate-500 hover:underline">
                            ยกเลิก
                          </button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-3">
                          <button
                            onClick={() =>
                              setEditing({
                                id: m.id,
                                deductingUnit: m.deductingUnit,
                                originalUnit: m.originalUnit ?? "",
                                note: m.note ?? "",
                              })
                            }
                            disabled={busy}
                            className="text-xs text-slate-700 hover:underline disabled:opacity-40"
                          >
                            แก้ไข
                          </button>
                          <button
                            onClick={() => setPendingDelete(m)}
                            disabled={busy}
                            className="text-xs text-red-700 hover:underline disabled:opacity-40"
                          >
                            เอาออก
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
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
