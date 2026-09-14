"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatAmount } from "@/lib/format";
import { DeductionRoundSummary, DeductionUnitRow } from "@/lib/types";
import ConfirmDialog from "@/components/ConfirmDialog";
import { describeDeductionPeriod } from "@/lib/deductionPeriod";
import { matchFileNameToUnit } from "@/lib/deductionFileMatch";
import {
  UNIT_FILTERS,
  UNIT_FILTER_LABELS,
  filterUnits,
  type UnitFilter,
} from "@/lib/listSearch";

interface BulkRow {
  file: File;
  unitName: string | null;
}

// Uploads run with limited concurrency instead of all at once — Vercel Blob
// and the round's units table both cope fine with a handful in flight, but
// firing 60 requests simultaneously from the browser has no benefit and
// makes the progress count jump unreadably.
const BULK_UPLOAD_CONCURRENCY = 4;

const STATUS_LABEL: Record<string, string> = {
  pending: "ยังไม่ส่ง",
  sent: "ส่งแล้ว",
  failed: "ส่งไม่สำเร็จ",
  skipped: "ข้ามรอบนี้",
};

const STATUS_CLASS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600 border-slate-200",
  sent: "bg-green-50 text-green-700 border-green-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  skipped: "bg-amber-50 text-amber-700 border-amber-200",
};

const VIA_LABEL: Record<string, string> = { line: "LINE", manual: "ส่งเอง" };

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function DeductionRoundsPanel() {
  const [rounds, setRounds] = useState<DeductionRoundSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [units, setUnits] = useState<DeductionUnitRow[]>([]);
  const [loadingRounds, setLoadingRounds] = useState(true);
  const [loadingUnits, setLoadingUnits] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyUnit, setBusyUnit] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DeductionRoundSummary | null>(null);

  // 105 units in one table, read once a month by eye. See lib/listSearch.ts.
  const [unitSearch, setUnitSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState<UnitFilter>("all");

  const [showNew, setShowNew] = useState(false);
  const [newPeriod, setNewPeriod] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [labelTouched, setLabelTouched] = useState(false);
  const [creating, setCreating] = useState(false);

  // One hidden input reused for every row: the row that opened it is held here
  // so the change handler knows which unit the chosen file belongs to.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetRef = useRef<string | null>(null);

  // Bulk upload: pick every unit's file at once instead of the per-row
  // click → find file → confirm cycle, matching each file to a unit by name
  // (lib/deductionFileMatch.ts) and letting staff fix any file the matcher
  // wasn't confident about before anything is actually sent.
  const bulkFileInputRef = useRef<HTMLInputElement | null>(null);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [bulkSummary, setBulkSummary] = useState<{ ok: number; failed: string[] } | null>(null);

  const fetchRounds = useCallback(async () => {
    setLoadingRounds(true);
    const res = await fetch("/api/deduction-rounds");
    const body = await res.json();
    setRounds(body.data ?? []);
    setLoadingRounds(false);
    return body.data as DeductionRoundSummary[] | undefined;
  }, []);

  const fetchUnits = useCallback(async (roundId: string) => {
    setLoadingUnits(true);
    const res = await fetch(`/api/deduction-rounds/${roundId}`);
    const body = await res.json();
    setUnits(body.data ?? []);
    setLoadingUnits(false);
  }, []);

  useEffect(() => {
    fetchRounds().then((data) => {
      if (data && data.length > 0) setSelectedId((prev) => prev ?? data[0].id);
    });
  }, [fetchRounds]);

  useEffect(() => {
    if (selectedId) fetchUnits(selectedId);
    else setUnits([]);
    // Switching rounds mid-review would otherwise leave bulk rows matched
    // against the previous round's unit list, silently uploading into the
    // wrong round if confirmed.
    setShowBulk(false);
    setBulkRows([]);
    setBulkSummary(null);
  }, [selectedId, fetchUnits]);

  const createRound = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/deduction-rounds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: newPeriod.trim(), label: newLabel.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "สร้างรอบไม่สำเร็จ");
        return;
      }
      setShowNew(false);
      setNewPeriod("");
      setNewLabel("");
      setLabelTouched(false);
      await fetchRounds();
      setSelectedId(body.id);
    } finally {
      setCreating(false);
    }
  };

  const openFilePicker = (unitName: string) => {
    uploadTargetRef.current = unitName;
    fileInputRef.current?.click();
  };

  const handleFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const unitName = uploadTargetRef.current;
    // Reset immediately so picking the same file twice in a row still fires.
    e.target.value = "";
    if (!file || !unitName || !selectedId) return;

    setBusyUnit(unitName);
    setError(null);
    try {
      const form = new FormData();
      form.append("unitName", unitName);
      form.append("file", file);
      const res = await fetch(`/api/deduction-rounds/${selectedId}/upload`, {
        method: "POST",
        body: form,
      });
      const body = await res.json();
      if (!res.ok) {
        setError(`${unitName}: ${body.error || "อัปโหลดไม่สำเร็จ"}`);
        return;
      }
      await Promise.all([fetchUnits(selectedId), fetchRounds()]);
    } finally {
      setBusyUnit(null);
    }
  };

  const openBulkPicker = () => {
    setBulkSummary(null);
    bulkFileInputRef.current?.click();
  };

  const handleBulkFilesChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const unitNames = units.map((u) => u.unitName);
    setBulkRows(files.map((file) => ({ file, unitName: matchFileNameToUnit(file.name, unitNames) })));
    setBulkSummary(null);
    setShowBulk(true);
  };

  const updateBulkRowUnit = (index: number, unitName: string | null) => {
    setBulkRows((prev) => prev.map((r, i) => (i === index ? { ...r, unitName } : r)));
  };

  const removeBulkRow = (index: number) => {
    setBulkRows((prev) => prev.filter((_, i) => i !== index));
  };

  const cancelBulk = () => {
    setShowBulk(false);
    setBulkRows([]);
    setBulkSummary(null);
  };

  // Units assigned to more than one selected file — uploading would just let
  // the last one silently win, which is worse than making staff resolve it
  // up front while every file is still on screen together.
  const duplicateUnitNames = (() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const row of bulkRows) {
      if (!row.unitName) continue;
      if (seen.has(row.unitName)) dupes.add(row.unitName);
      seen.add(row.unitName);
    }
    return dupes;
  })();

  const runBulkUpload = async () => {
    if (!selectedId) return;
    const toUpload = bulkRows.filter((r) => r.unitName && !duplicateUnitNames.has(r.unitName));
    if (toUpload.length === 0) return;

    setBulkUploading(true);
    setBulkProgress({ done: 0, total: toUpload.length });
    const failed: string[] = [];

    let cursor = 0;
    const worker = async () => {
      while (cursor < toUpload.length) {
        const row = toUpload[cursor];
        cursor += 1;
        const form = new FormData();
        form.append("unitName", row.unitName as string);
        form.append("file", row.file);
        try {
          const res = await fetch(`/api/deduction-rounds/${selectedId}/upload`, {
            method: "POST",
            body: form,
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            failed.push(`${row.unitName}: ${body.error || "อัปโหลดไม่สำเร็จ"}`);
          }
        } catch {
          failed.push(`${row.unitName}: เชื่อมต่อไม่สำเร็จ`);
        }
        setBulkProgress((prev) => ({ ...prev, done: prev.done + 1 }));
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(BULK_UPLOAD_CONCURRENCY, toUpload.length) }, worker)
    );

    setBulkUploading(false);
    setBulkSummary({ ok: toUpload.length - failed.length, failed });
    setBulkRows([]);
    await Promise.all([fetchUnits(selectedId), fetchRounds()]);
  };

  const send = async (unitName: string, channel: "line" | "manual") => {
    if (!selectedId) return;
    setBusyUnit(unitName);
    setError(null);
    try {
      const res = await fetch(`/api/deduction-rounds/${selectedId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitName, channel }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(`${unitName}: ${body.error || "ส่งไม่สำเร็จ"}`);
      }
      await Promise.all([fetchUnits(selectedId), fetchRounds()]);
    } finally {
      setBusyUnit(null);
    }
  };

  const setStatus = async (unitName: string, sendStatus: "pending" | "skipped") => {
    if (!selectedId) return;
    setBusyUnit(unitName);
    setError(null);
    try {
      const res = await fetch(`/api/deduction-rounds/${selectedId}/send`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitName, sendStatus }),
      });
      if (!res.ok) {
        const body = await res.json();
        setError(`${unitName}: ${body.error || "อัปเดตสถานะไม่สำเร็จ"}`);
      }
      await Promise.all([fetchUnits(selectedId), fetchRounds()]);
    } finally {
      setBusyUnit(null);
    }
  };

  const confirmDeleteRound = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await fetch(`/api/deduction-rounds/${id}`, { method: "DELETE" });
    const data = await fetchRounds();
    setSelectedId(data && data.length > 0 ? data[0].id : null);
  };

  const selected = rounds.find((r) => r.id === selectedId) ?? null;
  const totalAmount = units.reduce((sum, u) => sum + (u.amount ?? 0), 0);
  // The rows actually on screen. The totals above the table stay the round's
  // own — they are what the month is measured against, and a figure that moved
  // when a search box was typed in could not be read as progress.
  const shownUnits = filterUnits(units, unitSearch, unitFilter, (s) => STATUS_LABEL[s] ?? s);
  const unitsNarrowed = unitSearch.trim() !== "" || unitFilter !== "all";

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <div>
          <h2 className="font-semibold">รายการหักประจำเดือน</h2>
          <p className="text-xs text-slate-500 mt-1">
            ติดตามว่าหน่วยงานไหนมีไฟล์แล้ว ส่งแล้วหรือยัง ส่งเมื่อไร ทางไหน — สร้างรอบใหม่แล้วอัปโหลดไฟล์
            ของแต่ละหน่วยงานที่สร้างจากเครื่อง (ยังต้องสร้างไฟล์ด้วย workflow เดิม เพราะไฟล์เดือนก่อนอยู่ในเครื่อง
            ระบบบนเว็บเข้าไม่ถึง) หน่วยงานที่มี LINE UserID กดส่งจากหน้านี้ได้เลย
            ที่เหลือส่งเองแล้วกด "บันทึกว่าส่งแล้ว" เพื่อไม่ให้ตกหล่น
          </p>
        </div>
        <button
          onClick={() => setShowNew((v) => !v)}
          className="text-sm px-3 py-1.5 border border-slate-300 rounded whitespace-nowrap"
        >
          {showNew ? "ยกเลิก" : "+ สร้างรอบใหม่"}
        </button>
      </div>

      {showNew && (
        <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50">
          <label className="text-sm">
            <span className="block text-xs text-slate-500 mb-1">รหัสรอบ (MMYY)</span>
            <input
              value={newPeriod}
              onChange={(e) => {
                const period = e.target.value;
                setNewPeriod(period);
                // Fill the label in as they type, but stop as soon as they
                // edit it themselves so a deliberate name isn't overwritten.
                if (!labelTouched) setNewLabel(describeDeductionPeriod(period.trim()));
              }}
              placeholder="0969"
              className="border border-slate-300 rounded px-3 py-1.5 w-28 font-mono"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-slate-500 mb-1">ชื่อรอบ</span>
            <input
              value={newLabel}
              onChange={(e) => {
                setLabelTouched(true);
                setNewLabel(e.target.value);
              }}
              placeholder="กันยายน 2569"
              className="border border-slate-300 rounded px-3 py-1.5 w-48"
            />
          </label>
          <button
            onClick={createRound}
            disabled={creating || !newPeriod.trim() || !newLabel.trim()}
            className="text-sm px-3 py-1.5 bg-slate-900 text-white rounded disabled:opacity-50"
          >
            สร้างรอบ
          </button>
          <p className="text-xs text-slate-500">
            ระบบจะสร้างรายการครบทุกหน่วยงานให้เอง เพื่อให้เห็นว่าหน่วยไหนยังไม่ได้ทำ
          </p>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2 mx-4 mt-3">{error}</p>
      )}

      {loadingRounds ? (
        <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
      ) : rounds.length === 0 ? (
        <p className="text-slate-500 text-sm py-8 text-center">
          ยังไม่มีรอบการหัก — กด "สร้างรอบใหม่" เพื่อเริ่ม
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-slate-100">
            {rounds.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={`text-sm px-3 py-1.5 rounded border ${
                  r.id === selectedId
                    ? "bg-slate-900 text-white border-slate-900"
                    : "border-slate-300 text-slate-600"
                }`}
              >
                {r.label}{" "}
                <span className={r.id === selectedId ? "text-slate-300" : "text-slate-400"}>
                  ({r.sentUnits}/{r.totalUnits})
                </span>
              </button>
            ))}
          </div>

          {selected && (
            <div className="flex flex-wrap items-center gap-4 px-4 py-3 border-b border-slate-100 text-sm">
              <span>
                มีไฟล์แล้ว <strong>{selected.readyUnits}</strong>/{selected.totalUnits}
              </span>
              <span>
                ส่งแล้ว <strong className="text-green-700">{selected.sentUnits}</strong>/
                {selected.totalUnits}
              </span>
              {selected.failedUnits > 0 && (
                <span className="text-red-600">ส่งไม่สำเร็จ {selected.failedUnits}</span>
              )}
              {totalAmount > 0 && <span>ยอดรวมที่อัปโหลด {formatAmount(totalAmount)}</span>}
              <button onClick={openBulkPicker} className="text-slate-900 hover:underline">
                อัปโหลดหลายไฟล์พร้อมกัน
              </button>
              <button
                onClick={() => setPendingDelete(selected)}
                className="ml-auto text-red-600 hover:underline"
              >
                ลบรอบนี้
              </button>
            </div>
          )}

          {bulkSummary && (
            <div
              className={`mx-4 mt-3 rounded px-3 py-2 text-sm ${
                bulkSummary.failed.length > 0
                  ? "bg-amber-50 text-amber-800"
                  : "bg-green-50 text-green-700"
              }`}
            >
              อัปโหลดสำเร็จ {bulkSummary.ok} ไฟล์
              {bulkSummary.failed.length > 0 && (
                <>
                  , ไม่สำเร็จ {bulkSummary.failed.length} ไฟล์:
                  <ul className="list-disc pl-5 mt-1">
                    {bulkSummary.failed.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {showBulk && (
            <div className="mx-4 mt-3 border border-slate-200 rounded-lg p-3 bg-slate-50">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div>
                  <p className="text-sm font-medium">
                    เลือกไฟล์ทั้งหมด {bulkRows.length} ไฟล์แล้ว จับคู่กับหน่วยงานให้อัตโนมัติจากชื่อไฟล์
                  </p>
                  <p className="text-xs text-slate-500">
                    ไฟล์ไหนจับคู่ไม่ได้หรือผิด แก้ที่ช่องเลือกหน่วยงานของแถวนั้นได้เลยก่อนกดอัปโหลด
                  </p>
                </div>
                <button
                  onClick={openBulkPicker}
                  disabled={bulkUploading}
                  className="text-sm px-3 py-1.5 border border-slate-300 rounded whitespace-nowrap disabled:opacity-50"
                >
                  เลือกไฟล์ใหม่
                </button>
              </div>

              {bulkRows.length === 0 ? (
                <p className="text-sm text-slate-500 py-4 text-center">
                  ยังไม่ได้เลือกไฟล์ — กด "เลือกไฟล์ใหม่" แล้วเลือกได้หลายไฟล์พร้อมกัน (Ctrl/Shift คลิก)
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[700px]">
                    <thead className="text-slate-500 text-left">
                      <tr>
                        <th className="px-2 py-1">ไฟล์</th>
                        <th className="px-2 py-1">หน่วยงาน</th>
                        <th className="px-2 py-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkRows.map((row, i) => (
                        <tr key={i} className="border-t border-slate-200">
                          <td className="px-2 py-1 break-all">{row.file.name}</td>
                          <td className="px-2 py-1">
                            <select
                              value={row.unitName ?? ""}
                              onChange={(e) => updateBulkRowUnit(i, e.target.value || null)}
                              className={`border rounded px-2 py-1 text-sm w-64 ${
                                !row.unitName
                                  ? "border-amber-300 bg-amber-50"
                                  : duplicateUnitNames.has(row.unitName)
                                    ? "border-red-300 bg-red-50"
                                    : "border-slate-300"
                              }`}
                            >
                              <option value="">— ไม่จับคู่ (จะไม่อัปโหลด) —</option>
                              {units.map((u) => (
                                <option key={u.id} value={u.unitName}>
                                  {u.unitName}
                                </option>
                              ))}
                            </select>
                            {row.unitName && duplicateUnitNames.has(row.unitName) && (
                              <p className="text-xs text-red-600 mt-0.5">
                                มีไฟล์อื่นจับคู่หน่วยงานนี้ซ้ำ — เลือกให้เหลือไฟล์เดียว
                              </p>
                            )}
                          </td>
                          <td className="px-2 py-1 text-right">
                            <button
                              onClick={() => removeBulkRow(i)}
                              disabled={bulkUploading}
                              className="text-slate-400 hover:underline disabled:opacity-40"
                            >
                              ลบ
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={runBulkUpload}
                  disabled={
                    bulkUploading ||
                    bulkRows.filter((r) => r.unitName && !duplicateUnitNames.has(r.unitName))
                      .length === 0
                  }
                  className="text-sm px-3 py-1.5 bg-slate-900 text-white rounded disabled:opacity-50"
                >
                  {bulkUploading
                    ? `กำลังอัปโหลด… (${bulkProgress.done}/${bulkProgress.total})`
                    : `อัปโหลดทั้งหมด (${
                        bulkRows.filter((r) => r.unitName && !duplicateUnitNames.has(r.unitName))
                          .length
                      } ไฟล์)`}
                </button>
                <button
                  onClick={cancelBulk}
                  disabled={bulkUploading}
                  className="text-sm text-slate-500 hover:underline disabled:opacity-50"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          )}

          {selected && !loadingUnits && units.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-slate-100 text-sm">
              <input
                type="search"
                value={unitSearch}
                onChange={(e) => setUnitSearch(e.target.value)}
                placeholder="ค้นหาหน่วยงาน ชื่อไฟล์ อีเมล…"
                className="border border-slate-300 rounded px-3 py-1.5 text-sm w-full sm:w-72"
              />
              <div className="flex flex-wrap gap-1">
                {UNIT_FILTERS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setUnitFilter(option)}
                    className={`px-2.5 py-1 rounded border text-xs ${
                      unitFilter === option
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {UNIT_FILTER_LABELS[option]}
                  </button>
                ))}
              </div>
              {unitsNarrowed && (
                <span className="text-xs text-slate-500">
                  แสดง <strong className="num text-slate-900">{shownUnits.length}</strong> จาก{" "}
                  {units.length} หน่วยงาน
                  <button
                    type="button"
                    onClick={() => {
                      setUnitSearch("");
                      setUnitFilter("all");
                    }}
                    className="ml-2 text-slate-500 hover:underline"
                  >
                    ล้างตัวกรอง
                  </button>
                </span>
              )}
            </div>
          )}

          {loadingUnits ? (
            <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
          ) : unitsNarrowed && shownUnits.length === 0 ? (
            <p className="text-slate-500 text-sm py-8 text-center">
              ไม่มีหน่วยงานที่ตรงกับที่ค้นหา
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead className="bg-slate-100 text-slate-600 text-left">
                  <tr>
                    <th className="px-4 py-2">หน่วยงาน</th>
                    <th className="px-4 py-2">ไฟล์</th>
                    <th className="px-4 py-2">ยอดรวม</th>
                    <th className="px-4 py-2">สถานะ</th>
                    <th className="px-4 py-2">ส่งเมื่อ</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {shownUnits.map((u) => (
                    <tr key={u.id} className="border-t border-slate-100">
                      <td className="px-4 py-2">
                        {u.unitName}
                        {u.groupName && (
                          <span className="text-xs text-slate-400"> · {u.groupName}</span>
                        )}
                        <div className="text-xs text-slate-400">
                          {u.hasLineId ? "มี LINE" : "ไม่มี LINE"}
                          {u.email ? ` · ${u.email}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        {u.fileUrl ? (
                          <a
                            href={u.fileUrl}
                            className="text-slate-900 hover:underline break-all"
                          >
                            {u.fileName}
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {u.amount != null ? formatAmount(u.amount) : "—"}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs border ${
                            STATUS_CLASS[u.sendStatus] ?? STATUS_CLASS.pending
                          }`}
                          title={u.sendError ?? undefined}
                        >
                          {STATUS_LABEL[u.sendStatus] ?? u.sendStatus}
                        </span>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-slate-500">
                        {u.sentAt ? (
                          <>
                            {formatDateTime(u.sentAt)}
                            {u.sentVia && (
                              <span className="text-xs text-slate-400">
                                {" "}
                                · {VIA_LABEL[u.sentVia] ?? u.sentVia}
                              </span>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-right space-x-2">
                        <button
                          onClick={() => openFilePicker(u.unitName)}
                          disabled={busyUnit === u.unitName}
                          className="text-slate-600 hover:underline disabled:opacity-40"
                        >
                          {u.fileUrl ? "เปลี่ยนไฟล์" : "อัปโหลด"}
                        </button>
                        {u.fileUrl && u.hasLineId && (
                          <button
                            onClick={() => send(u.unitName, "line")}
                            disabled={busyUnit === u.unitName}
                            className="text-slate-900 hover:underline disabled:opacity-40"
                          >
                            ส่ง LINE
                          </button>
                        )}
                        {u.fileUrl && u.sendStatus !== "sent" && (
                          <button
                            onClick={() => send(u.unitName, "manual")}
                            disabled={busyUnit === u.unitName}
                            className="text-slate-600 hover:underline disabled:opacity-40"
                          >
                            บันทึกว่าส่งแล้ว
                          </button>
                        )}
                        {u.sendStatus === "pending" ? (
                          <button
                            onClick={() => setStatus(u.unitName, "skipped")}
                            disabled={busyUnit === u.unitName}
                            className="text-slate-400 hover:underline disabled:opacity-40"
                          >
                            ข้าม
                          </button>
                        ) : (
                          <button
                            onClick={() => setStatus(u.unitName, "pending")}
                            disabled={busyUnit === u.unitName}
                            className="text-slate-400 hover:underline disabled:opacity-40"
                          >
                            รีเซ็ต
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

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFileChosen}
        className="hidden"
      />

      <input
        ref={bulkFileInputRef}
        type="file"
        accept=".xlsx,.xls"
        multiple
        onChange={handleBulkFilesChosen}
        className="hidden"
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="ลบรอบการหักนี้?"
        description={
          pendingDelete
            ? `${pendingDelete.label} — จะลบสถานะการส่งของทุกหน่วยงานในรอบนี้ทิ้งทั้งหมด ` +
              `(ไฟล์ที่อัปโหลดไว้ยังอยู่ แต่จะไม่มีลิงก์ในระบบอีก) ถ้าแค่ทำรอบนี้เสร็จแล้ว ไม่ต้องลบ`
            : undefined
        }
        confirmLabel="ลบรอบ"
        onConfirm={confirmDeleteRound}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
