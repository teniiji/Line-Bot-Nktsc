"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatAmount } from "@/lib/format";
import { DeductionRoundSummary, DeductionUnitRow } from "@/lib/types";
import ConfirmDialog from "@/components/ConfirmDialog";
import { describeDeductionPeriod } from "@/lib/deductionPeriod";

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

  const [showNew, setShowNew] = useState(false);
  const [newPeriod, setNewPeriod] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [labelTouched, setLabelTouched] = useState(false);
  const [creating, setCreating] = useState(false);

  // One hidden input reused for every row: the row that opened it is held here
  // so the change handler knows which unit the chosen file belongs to.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetRef = useRef<string | null>(null);

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
              <button
                onClick={() => setPendingDelete(selected)}
                className="ml-auto text-red-600 hover:underline"
              >
                ลบรอบนี้
              </button>
            </div>
          )}

          {loadingUnits ? (
            <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
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
                  {units.map((u) => (
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
