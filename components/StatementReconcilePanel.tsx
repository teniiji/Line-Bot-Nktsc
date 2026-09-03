"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatAmount } from "@/lib/format";
import {
  StatementMemberRow,
  StatementRoundSummary,
  StatementUnmatchedRow,
} from "@/lib/types";
import ConfirmDialog from "@/components/ConfirmDialog";
import { describeDeductionPeriod } from "@/lib/deductionPeriod";

const STATUS_LABEL: Record<string, string> = {
  paid: "✅ ชำระครบ",
  overpaid: "⚠️ ชำระเกิน",
  unpaid: "❌ ยังค้าง",
};

const STATUS_CLASS: Record<string, string> = {
  paid: "bg-green-50 text-green-700 border-green-200",
  overpaid: "bg-amber-50 text-amber-700 border-amber-200",
  unpaid: "bg-red-50 text-red-700 border-red-200",
};

const ACCOUNTS = [
  { value: "413", label: "413 หนองคาย" },
  { value: "447", label: "447 บึงกาฬ" },
];

const formatDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("th-TH", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

export default function StatementReconcilePanel() {
  const [rounds, setRounds] = useState<StatementRoundSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<StatementMemberRow[]>([]);
  const [unmatched, setUnmatched] = useState<StatementUnmatchedRow[]>([]);
  const [totals, setTotals] = useState({ due: 0, paid: 0, outstanding: 0 });
  const [loadingRounds, setLoadingRounds] = useState(true);
  const [loadingRound, setLoadingRound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<StatementRoundSummary | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [showNew, setShowNew] = useState(false);
  const [newPeriod, setNewPeriod] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [labelTouched, setLabelTouched] = useState(false);

  const [account, setAccount] = useState("413");
  const membersInputRef = useRef<HTMLInputElement | null>(null);
  const statementInputRef = useRef<HTMLInputElement | null>(null);

  const fetchRounds = useCallback(async () => {
    setLoadingRounds(true);
    const res = await fetch("/api/statement-rounds");
    const body = await res.json();
    setLoadingRounds(false);
    setRounds(body.data ?? []);
    return body.data as StatementRoundSummary[] | undefined;
  }, []);

  const fetchRound = useCallback(async (roundId: string) => {
    setLoadingRound(true);
    const res = await fetch(`/api/statement-rounds/${roundId}`);
    const body = await res.json();
    setMembers(body.data ?? []);
    setUnmatched(body.unmatched ?? []);
    setTotals(body.totals ?? { due: 0, paid: 0, outstanding: 0 });
    setLoadingRound(false);
  }, []);

  useEffect(() => {
    fetchRounds().then((data) => {
      if (data && data.length > 0) setSelectedId((prev) => prev ?? data[0].id);
    });
  }, [fetchRounds]);

  useEffect(() => {
    if (selectedId) fetchRound(selectedId);
    else {
      setMembers([]);
      setUnmatched([]);
    }
    setNotice(null);
    setError(null);
  }, [selectedId, fetchRound]);

  const createRound = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/statement-rounds", {
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
      setBusy(false);
    }
  };

  const uploadMembers = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selectedId) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/statement-rounds/${selectedId}/members`, {
        method: "POST",
        body: form,
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "อัปโหลดรายชื่อไม่สำเร็จ");
        return;
      }
      setNotice(
        `นำเข้ารายชื่อหักไม่ได้ ${body.imported} คน` +
          (body.missingAccount > 0
            ? ` — มี ${body.missingAccount} คนไม่มีเลขบัญชีในไฟล์ จับคู่กับ Statement ไม่ได้`
            : "")
      );
      await Promise.all([fetchRound(selectedId), fetchRounds()]);
    } finally {
      setBusy(false);
    }
  };

  const uploadStatement = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selectedId) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("account", account);
      const res = await fetch(`/api/statement-rounds/${selectedId}/statement`, {
        method: "POST",
        body: form,
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "อ่าน Statement ไม่สำเร็จ");
        return;
      }
      setNotice(
        `บัญชี ${body.account} ${body.branch}: พบรายการโอน ${body.transfers} รายการ ` +
          `จับคู่สมาชิกได้ ${body.matched} คน` +
          (body.unmatched > 0 ? `, ไม่พบเจ้าของ ${body.unmatched} รายการ` : "")
      );
      await Promise.all([fetchRound(selectedId), fetchRounds()]);
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteRound = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await fetch(`/api/statement-rounds/${id}`, { method: "DELETE" });
    const data = await fetchRounds();
    setSelectedId(data && data.length > 0 ? data[0].id : null);
  };

  const selected = rounds.find((r) => r.id === selectedId) ?? null;
  const shown =
    statusFilter === "all" ? members : members.filter((m) => m.status === statusFilter);

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <div>
          <h2 className="font-semibold">เทียบ Statement (ใครโอนมาแล้วบ้าง)</h2>
          <p className="text-xs text-slate-500 mt-1">
            อัปโหลด 2 อย่างต่อรอบ: <strong>รายชื่อหักไม่ได้</strong> (ไฟล์ "รวม_ไม่ได้" — คอลัมน์ E
            ยอดหักไม่ได้, คอลัมน์ I เลขบัญชี) และ <strong>Statement ธนาคาร</strong> ของบัญชี 413
            หนองคาย / 447 บึงกาฬ — ระบบจับคู่รายการ "TR fr เลขบัญชี" กับสมาชิกให้เอง
            แล้วสรุปว่าใครชำระครบ/เกิน/ยังค้าง (โอนมาหลายครั้งรวมยอดให้ อัปโหลดไฟล์เดิมซ้ำได้ไม่นับซ้ำ)
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
                if (!labelTouched) setNewLabel(describeDeductionPeriod(period.trim()));
              }}
              placeholder="0669"
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
              placeholder="มิถุนายน 2569"
              className="border border-slate-300 rounded px-3 py-1.5 w-48"
            />
          </label>
          <button
            onClick={createRound}
            disabled={busy || !newPeriod.trim() || !newLabel.trim()}
            className="text-sm px-3 py-1.5 bg-slate-900 text-white rounded disabled:opacity-50"
          >
            สร้างรอบ
          </button>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2 mx-4 mt-3">{error}</p>
      )}
      {notice && (
        <p className="text-sm text-green-700 bg-green-50 rounded px-3 py-2 mx-4 mt-3">{notice}</p>
      )}

      {loadingRounds ? (
        <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
      ) : rounds.length === 0 ? (
        <p className="text-slate-500 text-sm py-8 text-center">
          ยังไม่มีรอบเทียบ Statement — กด "สร้างรอบใหม่" เพื่อเริ่ม
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
                  ({r.paidMembers + r.overpaidMembers}/{r.totalMembers})
                </span>
              </button>
            ))}
          </div>

          {selected && (
            <>
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-100 text-sm">
                <button
                  onClick={() => membersInputRef.current?.click()}
                  disabled={busy}
                  className="px-3 py-1.5 border border-slate-300 rounded disabled:opacity-50"
                >
                  อัปโหลดรายชื่อหักไม่ได้
                </button>
                <span className="text-slate-300">|</span>
                <select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  className="border border-slate-300 rounded px-2 py-1.5"
                >
                  {ACCOUNTS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => statementInputRef.current?.click()}
                  disabled={busy || selected.totalMembers === 0}
                  title={
                    selected.totalMembers === 0 ? "อัปโหลดรายชื่อหักไม่ได้ก่อน" : undefined
                  }
                  className="px-3 py-1.5 border border-slate-300 rounded disabled:opacity-50"
                >
                  อัปโหลด Statement
                </button>
                <button
                  onClick={() => setPendingDelete(selected)}
                  className="ml-auto text-red-600 hover:underline"
                >
                  ลบรอบนี้
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-4 px-4 py-3 border-b border-slate-100 text-sm">
                <span>
                  ทั้งหมด <strong>{selected.totalMembers}</strong> คน
                </span>
                <button
                  onClick={() => setStatusFilter(statusFilter === "paid" ? "all" : "paid")}
                  className={`hover:underline ${statusFilter === "paid" ? "font-semibold" : ""}`}
                >
                  ✅ ชำระครบ <strong className="text-green-700">{selected.paidMembers}</strong>
                </button>
                <button
                  onClick={() => setStatusFilter(statusFilter === "overpaid" ? "all" : "overpaid")}
                  className={`hover:underline ${statusFilter === "overpaid" ? "font-semibold" : ""}`}
                >
                  ⚠️ ชำระเกิน{" "}
                  <strong className="text-amber-700">{selected.overpaidMembers}</strong>
                </button>
                <button
                  onClick={() => setStatusFilter(statusFilter === "unpaid" ? "all" : "unpaid")}
                  className={`hover:underline ${statusFilter === "unpaid" ? "font-semibold" : ""}`}
                >
                  ❌ ยังค้าง <strong className="text-red-600">{selected.unpaidMembers}</strong>
                </button>
                <span className="text-slate-400">|</span>
                <span>ยอดหักไม่ได้ {formatAmount(totals.due)}</span>
                <span>โอนมาแล้ว {formatAmount(totals.paid)}</span>
                <span>
                  คงเหลือ <strong>{formatAmount(totals.outstanding)}</strong>
                </span>
                {statusFilter !== "all" && (
                  <button
                    onClick={() => setStatusFilter("all")}
                    className="text-slate-500 hover:underline"
                  >
                    ล้างตัวกรอง
                  </button>
                )}
              </div>
            </>
          )}

          {loadingRound ? (
            <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
          ) : members.length === 0 ? (
            <p className="text-slate-500 text-sm py-8 text-center">
              ยังไม่มีรายชื่อในรอบนี้ — กด "อัปโหลดรายชื่อหักไม่ได้" เพื่อเริ่ม
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[980px]">
                <thead className="bg-slate-100 text-slate-600 text-left">
                  <tr>
                    <th className="px-4 py-2">เลขสมาชิก</th>
                    <th className="px-4 py-2">ชื่อ-สกุล</th>
                    <th className="px-4 py-2">สังกัด</th>
                    <th className="px-4 py-2">เลขบัญชี</th>
                    <th className="px-4 py-2 text-right">ยอดหักไม่ได้</th>
                    <th className="px-4 py-2 text-right">โอนมาแล้ว</th>
                    <th className="px-4 py-2 text-right">ส่วนต่าง</th>
                    <th className="px-4 py-2">วันที่โอน</th>
                    <th className="px-4 py-2">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m) => {
                    const diff = Math.round((m.amountPaid - m.amountDue) * 100) / 100;
                    return (
                      <tr key={m.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 whitespace-nowrap">{m.memberNumber}</td>
                        <td className="px-4 py-2">
                          {m.name}
                          {m.note && (
                            <span className="text-xs text-slate-400"> · {m.note}</span>
                          )}
                        </td>
                        <td className="px-4 py-2">{m.unitName ?? "—"}</td>
                        <td className="px-4 py-2 font-mono text-xs">
                          {m.accountNumber ?? (
                            <span className="text-amber-700">ไม่มีเลขบัญชี</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          {formatAmount(m.amountDue)}
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          {m.amountPaid > 0 ? formatAmount(m.amountPaid) : "—"}
                        </td>
                        <td
                          className={`px-4 py-2 text-right whitespace-nowrap ${
                            diff < 0 ? "text-red-600" : diff > 0 ? "text-amber-700" : ""
                          }`}
                        >
                          {diff === 0 ? "0" : formatAmount(diff)}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-slate-500">
                          {formatDate(m.paidAt)}
                          {m.paidBranch && (
                            <span className="text-xs text-slate-400"> · {m.paidBranch}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs border ${
                              STATUS_CLASS[m.status] ?? STATUS_CLASS.unpaid
                            }`}
                          >
                            {STATUS_LABEL[m.status] ?? m.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {unmatched.length > 0 && (
            <div className="px-4 py-3 border-t border-slate-100">
              <h3 className="text-sm font-semibold text-amber-800">
                โอนเข้ามาแต่ไม่พบเจ้าของ ({unmatched.length} รายการ)
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                เลขบัญชีที่โอนเข้ามาไม่ตรงกับใครในรายชื่อหักไม่ได้รอบนี้ —
                ส่วนใหญ่คือเลขบัญชีในไฟล์รายชื่อผิดหรือว่าง แก้ในไฟล์แล้วอัปโหลดรายชื่อใหม่
                ระบบจะจับคู่ให้เองโดยไม่ต้องอัปโหลด Statement ซ้ำ
              </p>
              <table className="w-full text-sm mt-2">
                <thead className="text-slate-500 text-left">
                  <tr>
                    <th className="px-2 py-1">เลขบัญชี</th>
                    <th className="px-2 py-1 text-right">ยอด</th>
                    <th className="px-2 py-1">วันที่</th>
                    <th className="px-2 py-1">บัญชีที่รับ</th>
                  </tr>
                </thead>
                <tbody>
                  {unmatched.map((t) => (
                    <tr key={t.id} className="border-t border-slate-100">
                      <td className="px-2 py-1 font-mono text-xs">{t.accountNumber}</td>
                      <td className="px-2 py-1 text-right whitespace-nowrap">
                        {formatAmount(t.amount)}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap text-slate-500">
                        {formatDate(t.transferredAt)}
                      </td>
                      <td className="px-2 py-1 text-slate-500">{t.branch ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <input
        ref={membersInputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={uploadMembers}
        className="hidden"
      />
      <input
        ref={statementInputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={uploadStatement}
        className="hidden"
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="ลบรอบเทียบ Statement นี้?"
        description={
          pendingDelete
            ? `${pendingDelete.label} — จะลบรายชื่อหักไม่ได้และรายการโอนที่อ่านมาจาก Statement ของรอบนี้ทั้งหมด ` +
              `(ไฟล์ต้นฉบับในเครื่องไม่ถูกแตะต้อง อัปโหลดใหม่ได้เสมอ)`
            : undefined
        }
        confirmLabel="ลบรอบ"
        onConfirm={confirmDeleteRound}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
