"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { formatAmount } from "@/lib/format";
import {
  StatementFileSummary,
  StatementMemberRow,
  StatementRoundSummary,
  StatementTransferRow,
  StatementUnmatchedRow,
} from "@/lib/types";

import ConfirmDialog from "@/components/ConfirmDialog";
import { describeDeductionPeriod } from "@/lib/deductionPeriod";
import { downloadStatementMembersCsv } from "@/lib/csv";
import { EXCLUDE_REASONS } from "@/lib/statementSlipHints";
import {
  StatementSort,
  filterStatementMembers,
  hCodesOf,
  sortStatementMembers,
  summarizeStatementMembers,
  unitNamesOf,
} from "@/lib/statementFilters";

const SEARCH_DEBOUNCE_MS = 300;

const SORT_OPTIONS: { value: StatementSort; label: string }[] = [
  { value: "default", label: "ยังค้างขึ้นก่อน (ค่าเริ่มต้น)" },
  { value: "outstanding", label: "ยอดค้างมาก → น้อย" },
  { value: "hCode", label: "หน่วยคุม" },
  { value: "unitName", label: "สังกัด" },
  { value: "paidAt", label: "วันที่โอน (ล่าสุดก่อน)" },
  { value: "name", label: "ชื่อ ก-ฮ" },
  { value: "memberNumber", label: "เลขสมาชิก" },
];

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

const STATEMENT_BRANCH: Record<string, string> = { "413": "หนองคาย", "447": "บึงกาฬ" };

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
  const [statements, setStatements] = useState<StatementFileSummary[]>([]);
  const [transfers, setTransfers] = useState<StatementTransferRow[]>([]);
  const [excludedTotal, setExcludedTotal] = useState(0);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [pendingClear, setPendingClear] = useState<{ account: string; branch: string } | null>(
    null
  );
  const [totals, setTotals] = useState({ due: 0, paid: 0, outstanding: 0 });
  const [loadingRounds, setLoadingRounds] = useState(true);
  const [loadingRound, setLoadingRound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<StatementRoundSummary | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [hCodeFilter, setHCodeFilter] = useState("");
  const [assigningAccount, setAssigningAccount] = useState<string | null>(null);
  const [assignMemberNumber, setAssignMemberNumber] = useState("");
  const [sort, setSort] = useState<StatementSort>("default");

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
    setStatements(body.statements ?? []);
    setTransfers(body.transfers ?? []);
    setExcludedTotal(body.excludedTotal ?? 0);
    setTotals(body.totals ?? { due: 0, paid: 0, outstanding: 0 });
    setLoadingRound(false);
  }, []);

  const setTransferReason = async (transferId: string, excludedReason: string | null) => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/statement-rounds/${selectedId}/transfers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transferId, excludedReason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "บันทึกไม่สำเร็จ");
        return;
      }
      await Promise.all([fetchRound(selectedId), fetchRounds()]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    fetchRounds().then((data) => {
      if (data && data.length > 0) setSelectedId((prev) => prev ?? data[0].id);
    });
  }, [fetchRounds]);

  // Debounced so typing in the search box doesn't re-filter on every keystroke
  // — same 300ms the other panels' search boxes use.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (selectedId) fetchRound(selectedId);
    else {
      setMembers([]);
      setUnmatched([]);
      setStatements([]);
    }
    setNotice(null);
    setError(null);
    // A different round has different units and different people in it, so
    // carrying the previous round's filters over would show an empty table
    // for no visible reason.
    setStatusFilter("all");
    setSearchInput("");
    setSearch("");
    setUnitFilter("");
    setHCodeFilter("");
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
          (body.awaitingMembers > 0
            ? ` (อีก ${body.awaitingMembers} คนใน ${body.awaitingUnits} หน่วยงานยังไม่ส่งผลการหักมา จึงยังไม่นับ)`
            : "") +
          (body.filledFromDirectory > 0
            ? ` — เติมเลขบัญชีจากทะเบียนให้ ${body.filledFromDirectory} คน`
            : "") +
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
        `บัญชี ${body.account} ${body.branch}: อ่านได้ ${body.transfers} รายการ ` +
          `เพิ่มใหม่ ${body.added} รายการ` +
          (body.duplicates > 0 ? ` (ซ้ำกับที่มีอยู่แล้ว ${body.duplicates} รายการ ไม่นับซ้ำ)` : "") +
          `, จับคู่สมาชิกได้ ${body.matched} คน` +
          (body.unmatched > 0 ? `, ไม่พบเจ้าของ ${body.unmatched} รายการ` : "")
      );
      await Promise.all([fetchRound(selectedId), fetchRounds()]);
    } finally {
      setBusy(false);
    }
  };

  const assignAccount = async (accountNumber: string) => {
    if (!selectedId || !assignMemberNumber.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/statement-rounds/${selectedId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountNumber, memberNumber: assignMemberNumber.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "ระบุเจ้าของไม่สำเร็จ");
        return;
      }
      setNotice(
        `ผูกบัญชี ${body.accountNumber} เข้ากับ ${body.memberNumber} ${body.memberName} แล้ว ` +
          `(${body.transfers} รายการ ${formatAmount(body.amount)}) — จำไว้ใช้รอบต่อไปให้แล้ว`
      );
      setAssigningAccount(null);
      setAssignMemberNumber("");
      await Promise.all([fetchRound(selectedId), fetchRounds()]);
    } finally {
      setBusy(false);
    }
  };

  const confirmClearAccount = async () => {
    if (!pendingClear || !selectedId) return;
    const { account: acct, branch } = pendingClear;
    setPendingClear(null);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/statement-rounds/${selectedId}/statement?account=${encodeURIComponent(acct)}`,
        { method: "DELETE" }
      );
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "ล้างรายการไม่สำเร็จ");
        return;
      }
      setNotice(`ล้างรายการโอนของบัญชี ${acct} ${branch} แล้ว ${body.removed} รายการ`);
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
  const hCodes = hCodesOf(members);
  // The สังกัด list narrows to whatever หน่วยคุม is selected, so the two
  // dropdowns can't be combined into a pairing that matches nobody.
  const units = unitNamesOf(
    hCodeFilter ? members.filter((m) => m.hCode === hCodeFilter) : members
  );
  const shown = sortStatementMembers(
    filterStatementMembers(members, {
      search,
      unitName: unitFilter,
      hCode: hCodeFilter,
      status: statusFilter,
    }),
    sort
  );
  const shownTotals = summarizeStatementMembers(shown);
  const filtered =
    statusFilter !== "all" || unitFilter !== "" || hCodeFilter !== "" || search !== "";
  const missingAccountCount = members.filter((m) => !m.accountNumber).length;

  const transfersOf = (memberNumber: string) =>
    transfers.filter((t) => t.memberNumber === memberNumber);
  // A member whose money carries an unresolved hint gets a mark in the table,
  // so the ones worth opening are visible without expanding every row.
  const memberHasHint = (memberNumber: string) =>
    transfers.some((t) => t.memberNumber === memberNumber && t.slipHint && !t.excludedReason);
  const excludedTransfers = transfers.filter((t) => t.excludedReason);

  const clearFilters = () => {
    setStatusFilter("all");
    setUnitFilter("");
    setHCodeFilter("");
    setSearchInput("");
    setSearch("");
  };

  // Picking a หน่วยคุม that the current สังกัด doesn't belong to would leave a
  // stale unit selected and an empty table with no obvious cause.
  const changeHCode = (next: string) => {
    setHCodeFilter(next);
    if (unitFilter && next && !members.some((m) => m.hCode === next && m.unitName === unitFilter)) {
      setUnitFilter("");
    }
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <div>
          <h2 className="font-semibold">เทียบ Statement (ใครโอนมาแล้วบ้าง)</h2>
          <p className="text-xs text-slate-500 mt-1">
            อัปโหลด 2 อย่างต่อรอบ: <strong>รายชื่อหักไม่ได้</strong> (ไฟล์ "รวม_ไม่ได้" — คอลัมน์ E
            ยอดหักไม่ได้, คอลัมน์ I เลขบัญชี) และ <strong>Statement ธนาคาร</strong> ของบัญชี 413
            หนองคาย / 447 บึงกาฬ — ระบบจับคู่รายการ "TR fr เลขบัญชี" กับสมาชิกให้เอง
            แล้วสรุปว่าใครชำระครบ/เกิน/ยังค้าง — <strong>Statement อัปโหลดได้หลายไฟล์ต่อบัญชี</strong>{" "}
            (คนละช่วงวันที่) ระบบจะรวมกันให้ ไม่ทับของเดิม และรายการที่โหลดไว้แล้วจะไม่ถูกนับซ้ำ
            ต่อให้อัปโหลดไฟล์เดิมหรือช่วงวันที่คาบเกี่ยวกัน
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

              {selected.awaitingMembers > 0 && (
                <div className="px-4 py-2 border-b border-slate-100">
                  <p className="text-sm text-amber-800 bg-amber-50 rounded px-3 py-2">
                    ⏳ รอบนี้ยัง<strong>ไม่ครบทั้งสหกรณ์</strong> — มี{" "}
                    <strong>{selected.awaitingUnits}</strong> หน่วยงาน (
                    <strong>{selected.awaitingMembers}</strong> คน ยอดแจ้งหัก{" "}
                    {formatAmount(selected.awaitingAmount)}) ที่ยัง
                    <strong>ไม่ส่งผลการหักกลับมา</strong> ในไฟล์รายชื่อ
                    คนกลุ่มนี้จึงยังไม่อยู่ในตารางข้างล่าง (ยังไม่รู้ว่าหักได้หรือไม่ได้
                    ถ้านับเป็น "ยังค้าง" ไปเลยจะกลายเป็นทวงเงินคนที่อาจจะหักได้แล้ว) —
                    พอหน่วยงานส่งผลมาครบแล้วให้อัปโหลดไฟล์รายชื่อใหม่ ตัวเลขจะอัปเดตให้เอง
                  </p>
                </div>
              )}

              {statements.length > 0 && (
                <div className="px-4 py-2 border-b border-slate-100 text-xs text-slate-600">
                  <span className="text-slate-500">Statement ที่โหลดไว้แล้ว:</span>{" "}
                  {statements.map((s, i) => (
                    <span key={`${s.account}-${s.sourceFile ?? i}`}>
                      {i > 0 && <span className="text-slate-300"> · </span>}
                      <span className="font-mono">{s.account}</span> {s.sourceFile ?? "(ไม่ทราบชื่อไฟล์)"}{" "}
                      <span className="text-slate-400">
                        ({s.transfers} รายการ {formatAmount(s.amount)})
                      </span>
                    </span>
                  ))}
                  <span className="text-slate-400">
                    {" "}
                    — อัปโหลดเพิ่มได้เรื่อยๆ รายการที่มีอยู่แล้วจะไม่ถูกนับซ้ำ
                  </span>
                  <span className="ml-2">
                    {ACCOUNTS.filter((a) => statements.some((s) => s.account === a.value)).map(
                      (a) => (
                        <button
                          key={a.value}
                          onClick={() =>
                            setPendingClear({
                              account: a.value,
                              branch: STATEMENT_BRANCH[a.value] ?? "",
                            })
                          }
                          className="text-red-600 hover:underline ml-2"
                        >
                          ล้าง {a.value}
                        </button>
                      )
                    )}
                  </span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4 px-4 py-3 border-b border-slate-100 text-sm">
                <button
                  onClick={() => setStatusFilter("all")}
                  className={`hover:underline ${statusFilter === "all" ? "font-semibold" : ""}`}
                >
                  ทั้งหมด <strong>{selected.totalMembers}</strong> คน
                </button>
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
                {missingAccountCount > 0 && (
                  <button
                    onClick={() =>
                      setStatusFilter(statusFilter === "no_account" ? "all" : "no_account")
                    }
                    title="ไม่มีเลขบัญชีในไฟล์รายชื่อ จับคู่กับ Statement ไม่ได้เลย ต้องหาเลขบัญชีมาเติมก่อน"
                    className={`hover:underline ${
                      statusFilter === "no_account" ? "font-semibold" : ""
                    }`}
                  >
                    ⛔ ไม่มีเลขบัญชี{" "}
                    <strong className="text-amber-700">{missingAccountCount}</strong>
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-100 text-sm">
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="ค้นหาชื่อ, เลขสมาชิก, เลขบัญชี"
                  className="border border-slate-300 rounded px-3 py-1.5 w-64"
                />
                {hCodes.length > 0 && (
                  <select
                    value={hCodeFilter}
                    onChange={(e) => changeHCode(e.target.value)}
                    className="border border-slate-300 rounded px-2 py-1.5"
                    title="รหัสหน่วยคุม (H-code) จากคอลัมน์ J ของไฟล์รายชื่อหักไม่ได้"
                  >
                    <option value="">ทุกหน่วยคุม ({hCodes.length})</option>
                    {hCodes.map((h) => (
                      <option key={h} value={h}>
                        หน่วยคุม {h}
                      </option>
                    ))}
                  </select>
                )}
                <select
                  value={unitFilter}
                  onChange={(e) => setUnitFilter(e.target.value)}
                  className="border border-slate-300 rounded px-2 py-1.5 max-w-[16rem]"
                >
                  <option value="">ทุกสังกัด ({units.length})</option>
                  {units.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-slate-500">
                  เรียง
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as StatementSort)}
                    className="border border-slate-300 rounded px-2 py-1.5 text-slate-900"
                  >
                    {SORT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                {filtered && (
                  <button onClick={clearFilters} className="text-slate-500 hover:underline">
                    ล้างตัวกรอง
                  </button>
                )}
                <button
                  onClick={() => downloadStatementMembersCsv(shown, selected.label)}
                  disabled={shown.length === 0}
                  className="ml-auto px-3 py-1.5 border border-slate-300 rounded disabled:opacity-40"
                >
                  ส่งออก CSV ({shown.length})
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-4 px-4 py-2 border-b border-slate-100 text-sm bg-slate-50">
                {/* Totals follow the filters: with a สังกัด picked, "ยอดค้าง" of
                    that unit is the number staff are about to act on, not the
                    round-wide one. */}
                <span className="text-slate-500">
                  {filtered ? `แสดง ${shownTotals.count} จาก ${members.length} คน` : `${members.length} คน`}
                </span>
                <span>ยอดหักไม่ได้ {formatAmount(shownTotals.due)}</span>
                <span>โอนมาแล้ว {formatAmount(shownTotals.paid)}</span>
                <span>
                  คงเหลือ{" "}
                  <strong className={shownTotals.outstanding > 0 ? "text-red-600" : ""}>
                    {formatAmount(shownTotals.outstanding)}
                  </strong>
                </span>
                {filtered && (
                  <span className="text-slate-400">
                    (ทั้งรอบ: คงเหลือ {formatAmount(totals.outstanding)})
                  </span>
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
          ) : shown.length === 0 ? (
            <p className="text-slate-500 text-sm py-8 text-center">
              ไม่มีใครตรงกับตัวกรองนี้ —{" "}
              <button onClick={clearFilters} className="text-slate-900 hover:underline">
                ล้างตัวกรอง
              </button>
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1060px]">
                <thead className="bg-slate-100 text-slate-600 text-left">
                  <tr>
                    <th className="px-4 py-2">เลขสมาชิก</th>
                    <th className="px-4 py-2">ชื่อ-สกุล</th>
                    <th className="px-4 py-2">หน่วยคุม</th>
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
                      <Fragment key={m.id}>
                      <tr className="border-t border-slate-100">
                        <td className="px-4 py-2 whitespace-nowrap">{m.memberNumber}</td>
                        <td className="px-4 py-2">
                          {m.name}
                          {m.note && (
                            <span className="text-xs text-slate-400"> · {m.note}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-slate-500">
                          {m.hCode ?? "—"}
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
                          {m.amountPaid > 0 ? (
                            <button
                              onClick={() =>
                                setExpandedMember(
                                  expandedMember === m.memberNumber ? null : m.memberNumber
                                )
                              }
                              className="hover:underline"
                              title="ดูรายการโอนของคนนี้ / ระบุว่าเงินก้อนไหนไม่ใช่ค่าหักไม่ได้"
                            >
                              {formatAmount(m.amountPaid)}
                              {memberHasHint(m.memberNumber) && (
                                <span className="text-amber-600" title="อาจเป็นเงินที่โอนมาด้วยเหตุผลอื่น">
                                  {" "}⚠️
                                </span>
                              )}
                            </button>
                          ) : (
                            "—"
                          )}
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

                      {expandedMember === m.memberNumber && (
                        <tr className="bg-slate-50">
                          <td colSpan={10} className="px-4 py-2">
                            <p className="text-xs text-slate-500 mb-1">
                              รายการโอนของ {m.name} — ถ้าก้อนไหน<strong>ไม่ใช่</strong>เงินจ่ายค่าหักไม่ได้
                              (ซื้อหุ้น / ชำระหนี้ / ฝากเงิน ฯลฯ) เลือกเหตุผลไว้ ระบบจะไม่นับเป็นการชำระ
                            </p>
                            {transfersOf(m.memberNumber).map((t) => (
                              <div
                                key={t.id}
                                className="flex flex-wrap items-center gap-3 text-sm py-1 border-t border-slate-200"
                              >
                                <span className="whitespace-nowrap">{formatAmount(t.amount)}</span>
                                <span className="text-slate-500 whitespace-nowrap">
                                  {formatDate(t.transferredAt)}
                                </span>
                                <span className="font-mono text-xs text-slate-400">
                                  {t.accountNumber}
                                </span>
                                {t.slipHint && !t.excludedReason && (
                                  <span className="text-xs text-amber-700">
                                    ⚠️ อาจเป็น <strong>{t.slipHint.category}</strong>{" "}
                                    {formatAmount(t.slipHint.amount)} (สมาชิกส่งสลิป{" "}
                                    {formatDate(t.slipHint.date)})
                                  </span>
                                )}
                                <span className="ml-auto flex items-center gap-2">
                                  <select
                                    value={t.excludedReason ?? ""}
                                    onChange={(e) =>
                                      setTransferReason(t.id, e.target.value || null)
                                    }
                                    disabled={busy}
                                    className={`border rounded px-2 py-1 text-xs ${
                                      t.excludedReason
                                        ? "border-amber-300 bg-amber-50"
                                        : "border-slate-300"
                                    }`}
                                  >
                                    <option value="">นับเป็นจ่ายค่าหักไม่ได้</option>
                                    {EXCLUDE_REASONS.map((r) => (
                                      <option key={r} value={r}>
                                        ไม่เกี่ยวกับรอบนี้ — {r}
                                      </option>
                                    ))}
                                  </select>
                                </span>
                              </div>
                            ))}
                          </td>
                        </tr>
                      )}
                      </Fragment>
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
                กด <strong>"ระบุเจ้าของ"</strong> แล้วใส่เลขสมาชิก ระบบจะจับคู่ให้ทันที
                และ<strong>จำเลขบัญชีนี้ไว้ใช้รอบต่อๆ ไป</strong>ด้วย ไม่ต้องมาระบุซ้ำทุกเดือน
                (หรือจะแก้เลขบัญชีในไฟล์รายชื่อแล้วอัปโหลดใหม่ก็ได้เหมือนเดิม)
              </p>
              <table className="w-full text-sm mt-2">
                <thead className="text-slate-500 text-left">
                  <tr>
                    <th className="px-2 py-1">เลขบัญชี</th>
                    <th className="px-2 py-1 text-right">ยอด</th>
                    <th className="px-2 py-1">วันที่</th>
                    <th className="px-2 py-1">บัญชีที่รับ</th>
                    <th className="px-2 py-1">เป็นเงินอะไร</th>
                    <th className="px-2 py-1">เจ้าของ</th>
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
                      <td className="px-2 py-1">
                        <select
                          value=""
                          onChange={(e) =>
                            e.target.value && setTransferReason(t.id, e.target.value)
                          }
                          disabled={busy}
                          className="border border-slate-300 rounded px-2 py-1 text-xs"
                          title="เงินก้อนนี้ไม่ใช่ค่าหักไม่ได้ — เอาออกจากรายการที่ต้องตาม"
                        >
                          <option value="">ยังไม่ระบุ</option>
                          {EXCLUDE_REASONS.map((r) => (
                            <option key={r} value={r}>
                              ไม่เกี่ยวกับรอบนี้ — {r}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {assigningAccount === t.accountNumber ? (
                          <span className="inline-flex items-center gap-2">
                            <input
                              value={assignMemberNumber}
                              onChange={(e) => setAssignMemberNumber(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") assignAccount(t.accountNumber);
                                if (e.key === "Escape") setAssigningAccount(null);
                              }}
                              list="statement-member-numbers"
                              placeholder="เลขสมาชิก"
                              autoFocus
                              className="border border-slate-300 rounded px-2 py-1 text-sm w-44"
                            />
                            <button
                              onClick={() => assignAccount(t.accountNumber)}
                              disabled={busy || !assignMemberNumber.trim()}
                              className="text-slate-900 hover:underline disabled:opacity-40"
                            >
                              บันทึก
                            </button>
                            <button
                              onClick={() => setAssigningAccount(null)}
                              className="text-slate-500 hover:underline"
                            >
                              ยกเลิก
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              setAssigningAccount(t.accountNumber);
                              setAssignMemberNumber("");
                            }}
                            className="text-slate-900 hover:underline"
                          >
                            ระบุเจ้าของ
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Native autocomplete over this round's members, so staff can
                  type either the number or the name to find it. */}
              <datalist id="statement-member-numbers">
                {members.map((m) => (
                  <option key={m.id} value={m.memberNumber}>
                    {m.name}
                    {m.unitName ? ` · ${m.unitName}` : ""}
                  </option>
                ))}
              </datalist>
            </div>
          )}

          {excludedTransfers.length > 0 && (
            <div className="px-4 py-3 border-t border-slate-100">
              <h3 className="text-sm font-semibold text-slate-700">
                เงินเข้าที่ไม่เกี่ยวกับรอบนี้ ({excludedTransfers.length} รายการ ·{" "}
                {formatAmount(excludedTotal)})
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                เงินที่โอนเข้ามาจริงแต่เป็นเรื่องอื่น (ซื้อหุ้น ชำระหนี้ ฝากเงิน ฯลฯ)
                ไม่ถูกนับเป็นการจ่ายค่าหักไม่ได้ — เก็บไว้ให้เห็นเพราะเป็นเงินที่เข้ามาจริง
                ถ้าระบุผิดเลือก "นับเป็นจ่ายค่าหักไม่ได้" เพื่อเอากลับเข้ารอบได้
              </p>
              <table className="w-full text-sm mt-2">
                <thead className="text-slate-500 text-left">
                  <tr>
                    <th className="px-2 py-1">เลขบัญชี</th>
                    <th className="px-2 py-1 text-right">ยอด</th>
                    <th className="px-2 py-1">วันที่</th>
                    <th className="px-2 py-1">เจ้าของ</th>
                    <th className="px-2 py-1">เป็นเงินอะไร</th>
                  </tr>
                </thead>
                <tbody>
                  {excludedTransfers.map((t) => (
                    <tr key={t.id} className="border-t border-slate-100">
                      <td className="px-2 py-1 font-mono text-xs">{t.accountNumber}</td>
                      <td className="px-2 py-1 text-right whitespace-nowrap">
                        {formatAmount(t.amount)}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap text-slate-500">
                        {formatDate(t.transferredAt)}
                      </td>
                      <td className="px-2 py-1 text-slate-500">{t.memberNumber ?? "—"}</td>
                      <td className="px-2 py-1">
                        <select
                          value={t.excludedReason ?? ""}
                          onChange={(e) => setTransferReason(t.id, e.target.value || null)}
                          disabled={busy}
                          className="border border-amber-300 bg-amber-50 rounded px-2 py-1 text-xs"
                        >
                          <option value="">นับเป็นจ่ายค่าหักไม่ได้</option>
                          {EXCLUDE_REASONS.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
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

      <ConfirmDialog
        open={pendingClear !== null}
        title={`ล้างรายการโอนของบัญชี ${pendingClear?.account ?? ""}?`}
        description={
          pendingClear
            ? `จะลบรายการโอนทุกรายการที่อ่านมาจาก Statement ของบัญชี ${pendingClear.account} ` +
              `${pendingClear.branch} ในรอบนี้ (ทุกไฟล์) — อีกบัญชีและรายชื่อหักไม่ได้ไม่ถูกแตะต้อง ` +
              `ใช้เมื่ออัปโหลดผิดบัญชีหรืออยากเริ่มอ่านใหม่ อัปโหลดไฟล์เดิมกลับเข้าไปได้เสมอ`
            : undefined
        }
        confirmLabel="ล้างรายการ"
        onConfirm={confirmClearAccount}
        onCancel={() => setPendingClear(null)}
      />
    </div>
  );
}
