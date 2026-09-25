"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type {
  CarriedDebtCandidateRow,
  CarriedDebtLineCandidateRow,
  CarriedDebtPlanRow,
  CarriedDebtRow,
} from "@/lib/types";
import { formatAmount, formatStatementDate } from "@/lib/format";
import { cooperativeToday } from "@/lib/cooperativeClock";
import { stripHonorific } from "@/lib/nameMatch";
import PanelHelp from "@/components/PanelHelp";
import DateField from "@/components/DateField";

// ชำระข้ามเดือน — what members still owed when each month's round was
// closed, and what has been paid toward it since. One row per member per
// month, as the cooperative's own books keep it: a payment says which
// month it settled.

const STATUS_LABEL: Record<string, string> = {
  unpaid: "❌ ยังค้าง",
  paid: "✅ ชำระครบ",
  overpaid: "⚠️ ชำระเกิน",
};
const STATUS_CLASS: Record<string, string> = {
  unpaid: "bg-red-50 text-red-700 border-red-200",
  paid: "bg-green-50 text-green-700 border-green-200",
  overpaid: "bg-amber-50 text-amber-700 border-amber-200",
};
// Still owing first — that is who this tab exists to chase.
const STATUS_ORDER: Record<string, number> = { unpaid: 0, overpaid: 1, paid: 2 };

const outstandingOf = (debt: CarriedDebtRow) =>
  Math.max(0, Math.round((debt.amount - debt.amountPaid) * 100) / 100);

// Why the round a transfer sits in can, or cannot, spare it — see
// SpareReason in lib/carriedDebtCandidates.ts.
function reasonText(c: CarriedDebtCandidateRow): string {
  switch (c.reason) {
    case "unplaced":
      return `ไม่ได้นับให้ใครในรอบ ${c.roundLabel}`;
    case "collected":
      return `รอบ ${c.roundLabel} หักเงินเดือนได้แล้ว ยอดโอนนี้จึงเกินมา`;
    case "surplus":
      return `เกินจากยอดที่ต้องจ่ายของรอบ ${c.roundLabel} ${formatAmount(c.spare)}`;
    case "awaiting":
      return `รอบ ${c.roundLabel} ยังรอผลการหัก — ยังไม่รู้ว่ารอบนั้นต้องใช้ยอดนี้ไหม`;
    default:
      return `รอบ ${c.roundLabel} ยังนับยอดนี้เป็นค่าหักของเดือนนั้น — ใช้ก็ต่อเมื่อแน่ใจว่าโอนมาจ่ายหนี้เก่า`;
  }
}

export default function CarriedDebtsPanel() {
  const [debts, setDebts] = useState<CarriedDebtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [month, setMonth] = useState("");
  const [status, setStatus] = useState("unpaid");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const [cashAmount, setCashAmount] = useState("");
  const [cashDate, setCashDate] = useState(cooperativeToday());
  const [cashNote, setCashNote] = useState("");

  const [candidates, setCandidates] = useState<CarriedDebtCandidateRow[]>([]);
  const [lineCandidates, setLineCandidates] = useState<CarriedDebtLineCandidateRow[]>([]);
  const [plan, setPlan] = useState<CarriedDebtPlanRow[]>([]);
  const [planTotal, setPlanTotal] = useState(0);
  const [checking, setChecking] = useState(false);
  const [confirmPlan, setConfirmPlan] = useState(false);
  // Planned payments staff unticked in the confirmation list, by planKey.
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [planSearch, setPlanSearch] = useState("");
  const [applyAmounts, setApplyAmounts] = useState<Record<string, string>>({});

  // Statement transfers that could be paying each open debt. Read-only; a
  // candidate is applied by the button beside it or, for the clear ones, in
  // bulk after staff have seen the list.
  const fetchCandidates = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/carried-debts/candidates");
      const body = await res.json().catch(() => ({}));
      setCandidates(body.candidates ?? []);
      setLineCandidates(body.lineCandidates ?? []);
      setPlan(body.plan ?? []);
      setPlanTotal(body.planTotal ?? 0);
      setApplyAmounts({});
    } finally {
      setChecking(false);
    }
  }, []);

  const fetchDebts = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/carried-debts");
    const body = await res.json().catch(() => ({}));
    setDebts(body.data ?? []);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([fetchDebts(), fetchCandidates()]);
  }, [fetchDebts, fetchCandidates]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const candidatesOf = useMemo(() => {
    const map = new Map<string, CarriedDebtCandidateRow[]>();
    for (const c of candidates) map.set(c.debtId, [...(map.get(c.debtId) ?? []), c]);
    return map;
  }, [candidates]);
  const linesOf = useMemo(() => {
    const map = new Map<string, CarriedDebtLineCandidateRow[]>();
    for (const l of lineCandidates) map.set(l.debtId, [...(map.get(l.debtId) ?? []), l]);
    return map;
  }, [lineCandidates]);
  const debtById = useMemo(() => new Map(debts.map((d) => [d.id, d])), [debts]);
  // What each planned payment's source was, for the confirmation list.
  const sourceInfo = useMemo(() => {
    const map = new Map<string, { date: string | null; from: string }>();
    for (const c of candidates) {
      map.set(`${c.debtId}|t:${c.transferId}`, { date: c.transferredAt, from: `จากรอบ ${c.roundLabel}` });
    }
    for (const l of lineCandidates) {
      map.set(`${l.debtId}|l:${l.lineId}`, { date: l.postedAt, from: "จากเงินเข้าประจำวัน" });
    }
    return map;
  }, [candidates, lineCandidates]);

  // The months on offer, newest first, from the debts themselves — a closed
  // round nobody owed anything on has nothing to show here.
  const months = useMemo(() => {
    const seen = new Map<string, string>();
    for (const d of debts) if (!seen.has(d.sourceRoundId)) seen.set(d.sourceRoundId, d.sourceLabel);
    return [...seen.entries()];
  }, [debts]);

  const inMonth = debts.filter((d) => !month || d.sourceRoundId === month);
  const found = (d: CarriedDebtRow) =>
    d.status === "unpaid" && ((candidatesOf.get(d.id)?.length ?? 0) > 0 || linesOf.has(d.id));
  const counts = {
    all: inMonth.length,
    unpaid: inMonth.filter((d) => d.status === "unpaid").length,
    found: inMonth.filter(found).length,
    paid: inMonth.filter((d) => d.status === "paid").length,
    overpaid: inMonth.filter((d) => d.status === "overpaid").length,
  };
  const needle = search.trim().toLowerCase();
  const shown = inMonth
    .filter((d) => status === "all" || (status === "found" ? found(d) : d.status === status))
    .filter(
      (d) =>
        !needle ||
        [d.memberNumber, d.name, d.unitName ?? "", d.accountNumber ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(needle)
    )
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 0) - (STATUS_ORDER[b.status] ?? 0) ||
        stripHonorific(a.name).localeCompare(stripHonorific(b.name), "th") ||
        a.sourceLabel.localeCompare(b.sourceLabel, "th")
    );
  const totals = {
    carried: Math.round(inMonth.reduce((s, d) => s + d.amount, 0) * 100) / 100,
    paid: Math.round(inMonth.reduce((s, d) => s + d.amountPaid, 0) * 100) / 100,
    outstanding: Math.round(inMonth.reduce((s, d) => s + outstandingOf(d), 0) * 100) / 100,
  };

  const open = (debt: CarriedDebtRow) => {
    if (expanded === debt.id) {
      setExpanded(null);
      return;
    }
    setExpanded(debt.id);
    setCashAmount(String(outstandingOf(debt) || ""));
    setCashDate(cooperativeToday());
    setCashNote("");
    setError(null);
  };

  const recordCash = async (debt: CarriedDebtRow) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/carried-debts/${debt.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(cashAmount), paidAt: cashDate, note: cashNote }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "บันทึกไม่สำเร็จ");
        return;
      }
      setNotice(
        `บันทึกเงินสด ${formatAmount(Number(cashAmount))} ให้ ${debt.memberNumber} ${debt.name} (${debt.sourceLabel}) แล้ว`
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const removePayment = async (debt: CarriedDebtRow, paymentId: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/carried-debts/${debt.id}/payments/${paymentId}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "ลบไม่สำเร็จ");
        return;
      }
      setNotice("ลบรายการชำระแล้ว — ถ้าเป็นเงินโอน ยอดนั้นกลับไปนับในรอบที่โอนเข้ามาแล้ว");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  // One candidate, by hand, through the round's own carry route — the same
  // one the "ชำระข้ามเดือน" button on the round page uses.
  const applyCandidate = async (debt: CarriedDebtRow, c: CarriedDebtCandidateRow) => {
    const key = `${c.debtId}|t:${c.transferId}`;
    const amount = Number(applyAmounts[key] ?? c.suggested);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/statement-rounds/${c.roundId}/transfers/${c.transferId}/carry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ debtId: debt.id, amount }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "ใช้ยอดนี้ไม่สำเร็จ");
        return;
      }
      setNotice(
        `ใช้ยอดโอน ${formatAmount(amount)} (รอบ ${c.roundLabel}) ชำระหนี้ ${debt.sourceLabel} ของ ${debt.memberNumber} ${debt.name} แล้ว`
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  // A daily line no round holds — see app/api/carried-debts/[id]/from-line.
  const applyLine = async (debt: CarriedDebtRow, l: CarriedDebtLineCandidateRow) => {
    const key = `${l.debtId}|l:${l.lineId}`;
    const amount = Number(applyAmounts[key] ?? l.suggested);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/carried-debts/${debt.id}/from-line`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineId: l.lineId, amount }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "ใช้ยอดนี้ไม่สำเร็จ");
        return;
      }
      setNotice(
        `ใช้ยอดเงินเข้าวันที่ ${l.postedAt ? formatStatementDate(l.postedAt) : "—"} ${formatAmount(amount)} ชำระหนี้ ${debt.sourceLabel} ของ ${debt.memberNumber} ${debt.name} แล้ว`
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const planKey = (p: CarriedDebtPlanRow) => `${p.debtId}|${p.source}`;
  const chosenPlan = plan.filter((p) => !skipped.has(planKey(p)));
  const chosenTotal = Math.round(chosenPlan.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
  const planNeedle = planSearch.trim().toLowerCase();
  const shownPlan = plan.filter((p) => {
    if (!planNeedle) return true;
    const debt = debtById.get(p.debtId);
    return `${debt?.memberNumber ?? ""} ${debt?.name ?? ""}`.toLowerCase().includes(planNeedle);
  });

  const applyPlan = async () => {
    setConfirmPlan(false);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/carried-debts/candidates/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: chosenPlan.map((p) => ({ debtId: p.debtId, source: p.source })) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "บันทึกไม่สำเร็จ");
        return;
      }
      setNotice(
        `ใช้ยอดโอนชำระหนี้ข้ามเดือนแล้ว ${body.applied} รายการ (${body.debts} คน) รวม ${formatAmount(body.amount ?? 0)}`
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-white rounded-lg shadow">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="font-semibold">ชำระข้ามเดือน (ยอดค้างที่ยกมาจากรอบที่ปิดแล้ว)</h2>
        <PanelHelp summary="ยอดที่สมาชิกยังค้างตอนปิดรอบสิ้นเดือน ตั้งเป็นหนี้แยกของแต่ละเดือน และการชำระที่เข้ามาภายหลัง">
          <p>
            ยอดเข้ามาที่นี่จากปุ่ม <strong>&quot;🔒 ปิดรอบ&quot;</strong> ที่แถบเทียบ Statement — ทุกคนที่ยังค้างตอนปิด
            จะถูกยกมาเป็นหนี้ของเดือนนั้น แยกทีละเดือน
          </p>
          <p>
            <strong>เงินโอน</strong>: ไปที่รอบของเดือนที่เงินเข้ามา (เช่น รอบกันยายน) แล้วกด{" "}
            <strong>&quot;ชำระข้ามเดือน&quot;</strong> ที่รายการโอนนั้น เลือกว่าจ่ายหนี้เดือนไหน — ยอดนั้นจะไม่นับในรอบกันยายนแล้ว
            มานับที่นี่แทน สมาชิกที่ค้างข้ามเดือนจะมีป้าย ⚠️ ค้างข้ามเดือน ในรอบนั้น
          </p>
          <p>
            <strong>ตรวจจาก Statement</strong>: ระบบหายอดโอนจากบัญชีที่รู้ว่าเป็นของสมาชิกแต่ละคน ในทุกรอบที่อัป Statement
            ไว้ แล้วบอกว่ารอบนั้นต้องใช้ยอดนั้นหรือไม่ (💸 พบยอดโอน) — กดที่แถวเพื่อดูและกด &quot;ใช้ชำระหนี้นี้&quot; ·
            ปุ่ม &quot;✅ ใช้ยอดที่ชัดเจน&quot; ใช้ให้ทีเดียวเฉพาะรายที่ไม่ต้องเลือก (ค้างเดือนเดียว และรอบที่เงินเข้าไม่ต้องใช้ยอดนั้น)
            โดยแสดงรายการให้ตรวจและติ๊กเลือกก่อนยืนยัน
          </p>
          <p>
            <strong>เงินสด</strong>: บันทึกได้ที่นี่เลย (กดที่แถวสมาชิก) · ลบรายการชำระที่บันทึกผิดได้ที่นี่ —
            ถ้าเป็นเงินโอน ยอดจะกลับไปนับในรอบที่โอนเข้ามา
          </p>
        </PanelHelp>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-100 text-sm">
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="border border-slate-300 rounded-md px-2 py-1.5 bg-white"
        >
          <option value="">ทุกเดือน</option>
          {months.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        {(
          [
            ["unpaid", "❌ ยังค้าง"],
            ["found", "💸 พบยอดโอน"],
            ["paid", "✅ ชำระครบ"],
            ["overpaid", "⚠️ ชำระเกิน"],
            ["all", "ทั้งหมด"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setStatus(value)}
            className={`px-3 py-1.5 rounded-full border text-sm ${
              status === value ? "bg-slate-900 text-white border-slate-900" : "border-slate-300 text-slate-600"
            }`}
          >
            {label} <span className="num">{counts[value]}</span>
          </button>
        ))}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหา ชื่อ เลขสมาชิก หน่วย เลขบัญชี"
          className="border border-slate-300 rounded-md px-3 py-1.5 w-full sm:w-72 sm:ml-auto"
        />
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-2 border-b border-slate-100 text-sm text-slate-600">
        <span>
          ยกมา <strong className="num text-slate-900">{formatAmount(totals.carried)}</strong>
        </span>
        <span>
          ชำระแล้ว <strong className="num text-green-700">{formatAmount(totals.paid)}</strong>
        </span>
        <span>
          คงเหลือ <strong className="num text-red-600">{formatAmount(totals.outstanding)}</strong>
        </span>
      </div>

      {debts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-slate-100 text-sm bg-sky-50/50">
          <span className="text-slate-600">
            {checking
              ? "กำลังตรวจยอดโอนจาก Statement…"
              : `ตรวจจาก Statement: พบยอดโอนที่อาจเป็นการชำระหนี้ ${counts.found} คน`}
          </span>
          <button
            onClick={fetchCandidates}
            disabled={checking || busy}
            className="text-xs border border-slate-300 rounded px-2.5 py-1 bg-white disabled:opacity-50"
          >
            🔍 ตรวจอีกครั้ง
          </button>
          {plan.length > 0 && (
            <button
              onClick={() => {
                setSkipped(new Set());
                setPlanSearch("");
                setConfirmPlan(true);
              }}
              disabled={checking || busy}
              className="text-xs text-white bg-emerald-700 rounded px-2.5 py-1 disabled:opacity-50 sm:ml-auto"
            >
              ✅ ใช้ยอดที่ชัดเจน {plan.length} รายการ · {formatAmount(planTotal)}
            </button>
          )}
        </div>
      )}

      {confirmPlan && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
          onClick={() => setConfirmPlan(false)}
        >
          <div
            className="bg-white rounded-lg shadow-lg p-5 max-w-3xl w-full space-y-3 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-lg">ตรวจรายการก่อนใช้ยอด ({plan.length} รายการ)</h3>
            <p className="text-sm text-slate-600">
              เฉพาะรายการที่ชัดเจน: สมาชิกค้างหนี้เดือนเดียว บัญชีที่โอนไม่ใช่ของลูกหนี้คนอื่น
              และรอบที่เงินเข้าไม่ต้องใช้ยอดนี้ — เอาเครื่องหมายถูกออกจากรายการที่ไม่ต้องการใช้
              รายการที่ไม่เลือกจะยังอยู่ที่แถวสมาชิก ใช้เองทีละรายการได้ภายหลัง
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input
                type="search"
                value={planSearch}
                onChange={(e) => setPlanSearch(e.target.value)}
                placeholder="ค้นหา เลขสมาชิก ชื่อ"
                className="border border-slate-300 rounded-md px-3 py-1.5 w-full sm:w-64"
              />
              <span className="sm:ml-auto text-slate-600">
                เลือก <strong className="num">{chosenPlan.length}</strong> จาก{" "}
                <span className="num">{plan.length}</span> รายการ ·{" "}
                <strong className="num text-emerald-700">{formatAmount(chosenTotal)}</strong>
              </span>
            </div>
            <div className="overflow-auto text-sm border border-slate-200 rounded min-h-0 flex-1">
              <table className="w-full">
                <thead className="bg-slate-50 text-slate-500 text-left text-xs sticky top-0">
                  <tr>
                    <th className="px-2 py-2 w-8">
                      <input
                        type="checkbox"
                        aria-label="เลือกทั้งหมดที่แสดง"
                        checked={shownPlan.length > 0 && shownPlan.every((p) => !skipped.has(planKey(p)))}
                        onChange={(e) => {
                          const next = new Set(skipped);
                          for (const p of shownPlan) {
                            if (e.target.checked) next.delete(planKey(p));
                            else next.add(planKey(p));
                          }
                          setSkipped(next);
                        }}
                      />
                    </th>
                    <th className="px-2 py-2 font-semibold">สมาชิก · หนี้เดือน</th>
                    <th className="px-2 py-2 font-semibold">ยอดโอน</th>
                    <th className="px-2 py-2 font-semibold text-right">ยอดที่จะใช้</th>
                  </tr>
                </thead>
                <tbody>
                  {shownPlan.map((p) => {
                    const key = planKey(p);
                    const debt = debtById.get(p.debtId);
                    const info = sourceInfo.get(key);
                    const chosen = !skipped.has(key);
                    return (
                      <tr
                        key={key}
                        onClick={() => {
                          const next = new Set(skipped);
                          if (chosen) next.add(key);
                          else next.delete(key);
                          setSkipped(next);
                        }}
                        className={`border-t border-slate-100 align-top cursor-pointer ${
                          chosen ? "" : "text-slate-400 bg-slate-50"
                        }`}
                      >
                        <td className="px-2 py-1.5">
                          <input type="checkbox" checked={chosen} readOnly aria-label={`เลือก ${debt?.memberNumber}`} />
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="num">{debt?.memberNumber}</span> {debt?.name}
                          <div className="text-xs text-slate-500">
                            หนี้ {debt?.sourceLabel} · ค้าง {debt ? formatAmount(outstandingOf(debt)) : "—"}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="num">{info?.date ? formatStatementDate(info.date) : "—"}</span>
                          <div className="text-xs text-slate-500">{info?.from}</div>
                        </td>
                        <td className="px-2 py-1.5 num text-right font-medium whitespace-nowrap">
                          {formatAmount(p.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmPlan(false)}
                className="border border-slate-300 rounded px-4 py-2 text-sm font-medium"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={applyPlan}
                disabled={chosenPlan.length === 0 || busy}
                className="rounded px-4 py-2 text-sm font-medium text-white bg-emerald-700 disabled:opacity-50"
              >
                ยืนยันใช้ยอด {chosenPlan.length} รายการ
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && <p className="text-sm text-green-700 bg-green-50 px-4 py-2">{notice}</p>}
      {error && <p className="text-sm text-red-700 bg-red-50 px-4 py-2">{error}</p>}

      {loading ? (
        <p className="text-slate-500 text-center py-8">กำลังโหลด…</p>
      ) : debts.length === 0 ? (
        <p className="text-slate-500 text-center py-8 px-4">
          ยังไม่มีหนี้ข้ามเดือน — จะมีเมื่อกด &quot;🔒 ปิดรอบ&quot; ที่แถบเทียบ Statement
        </p>
      ) : shown.length === 0 ? (
        <p className="text-slate-500 text-center py-8">ไม่พบรายการตามที่เลือก</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-4 py-2.5 font-semibold">เดือน</th>
                <th className="px-4 py-2.5 font-semibold">เลขสมาชิก</th>
                <th className="px-4 py-2.5 font-semibold">ชื่อ-สกุล</th>
                <th className="px-4 py-2.5 font-semibold">หน่วยคุม · สังกัด</th>
                <th className="px-4 py-2.5 font-semibold text-right">ยอดยกมา</th>
                <th className="px-4 py-2.5 font-semibold text-right">ชำระแล้ว</th>
                <th className="px-4 py-2.5 font-semibold text-right">คงเหลือ</th>
                <th className="px-4 py-2.5 font-semibold">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((debt) => (
                <Fragment key={debt.id}>
                  <tr
                    onClick={() => open(debt)}
                    className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="px-4 py-2.5 whitespace-nowrap">{debt.sourceLabel}</td>
                    <td className="px-4 py-2.5 num">{debt.memberNumber}</td>
                    <td className="px-4 py-2.5">{debt.name}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {debt.hCode && <span className="num text-slate-400 mr-1.5">{debt.hCode}</span>}
                      {debt.unitName ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 num text-right">{formatAmount(debt.amount)}</td>
                    <td className="px-4 py-2.5 num text-right">
                      {debt.amountPaid > 0 ? formatAmount(debt.amountPaid) : "—"}
                    </td>
                    <td className="px-4 py-2.5 num text-right font-medium text-red-600">
                      {outstandingOf(debt) > 0 ? formatAmount(outstandingOf(debt)) : "0"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium border ${
                          STATUS_CLASS[debt.status] ?? STATUS_CLASS.unpaid
                        }`}
                      >
                        {STATUS_LABEL[debt.status] ?? debt.status}
                      </span>
                      {found(debt) && (
                        <span className="ml-1.5 inline-block px-2 py-0.5 rounded-full text-xs border bg-sky-50 text-sky-700 border-sky-200 whitespace-nowrap">
                          💸 พบยอดโอน
                        </span>
                      )}
                    </td>
                  </tr>
                  {expanded === debt.id && (
                    <tr className="bg-slate-50">
                      <td colSpan={8} className="px-4 py-2">
                        <p className="text-xs text-slate-500 mb-1">
                          การชำระหนี้เดือน {debt.sourceLabel} ของ {debt.name}
                        </p>
                        {debt.payments.length === 0 ? (
                          <p className="text-sm text-slate-400 py-1">ยังไม่มีการชำระ</p>
                        ) : (
                          debt.payments.map((p) => (
                            <div
                              key={p.id}
                              className="flex flex-wrap items-center gap-3 text-sm py-1 border-t border-slate-200"
                            >
                              <span className="num font-medium">{formatAmount(p.amount)}</span>
                              <span className="num text-slate-500">{formatStatementDate(p.paidAt)}</span>
                              {p.method === "cash" ? (
                                <span className="text-xs text-sky-700">💵 เงินสด</span>
                              ) : (
                                <span className="text-xs text-slate-500">
                                  โอน · {p.roundLabel ? `จากรอบ ${p.roundLabel}` : "จากเงินเข้าประจำวัน"}
                                  {p.accountNumber && (
                                    <span className="font-mono text-slate-400"> · {p.accountNumber}</span>
                                  )}
                                </span>
                              )}
                              {p.note && <span className="text-xs text-slate-500">· {p.note}</span>}
                              <button
                                onClick={() => removePayment(debt, p.id)}
                                disabled={busy}
                                className="ml-auto text-xs text-red-700 hover:underline disabled:opacity-40"
                              >
                                ลบรายการนี้
                              </button>
                            </div>
                          ))
                        )}
                        {debt.status === "unpaid" &&
                          ((candidatesOf.get(debt.id)?.length ?? 0) > 0 || linesOf.has(debt.id)) && (
                            <div className="pt-2 mt-1 border-t border-slate-200">
                              <p className="text-xs text-sky-800 font-medium mb-1">
                                💸 ยอดโอนจากบัญชีของสมาชิกที่พบใน Statement
                              </p>
                              {(candidatesOf.get(debt.id) ?? []).map((c) => {
                                const key = `${c.debtId}|t:${c.transferId}`;
                                return (
                                  <div
                                    key={key}
                                    className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm py-1"
                                  >
                                    <span className="num text-slate-500">
                                      {c.transferredAt ? formatStatementDate(c.transferredAt) : "—"}
                                    </span>
                                    <span className="num font-medium">{formatAmount(c.amount)}</span>
                                    {c.available < c.amount - 0.01 && (
                                      <span className="text-xs text-slate-500">
                                        (เหลือ {formatAmount(c.available)})
                                      </span>
                                    )}
                                    <span className="text-xs text-slate-500">
                                      รอบ {c.roundLabel}
                                      {c.roundClosed && " 🔒"}
                                      <span className="font-mono text-slate-400"> · {c.accountNumber}</span>
                                    </span>
                                    <span
                                      className={`text-xs ${
                                        c.spare > 0.01 ? "text-emerald-700" : "text-amber-700"
                                      }`}
                                    >
                                      {reasonText(c)}
                                    </span>
                                    <span className="flex items-center gap-1.5 ml-auto">
                                      <input
                                        type="number"
                                        inputMode="decimal"
                                        step="0.01"
                                        value={applyAmounts[key] ?? String(c.suggested)}
                                        onChange={(e) =>
                                          setApplyAmounts((prev) => ({ ...prev, [key]: e.target.value }))
                                        }
                                        className="border border-slate-300 rounded px-2 py-1 text-xs w-24"
                                      />
                                      <button
                                        onClick={() => applyCandidate(debt, c)}
                                        disabled={busy || !(Number(applyAmounts[key] ?? c.suggested) > 0)}
                                        className="text-xs text-white bg-sky-700 rounded px-2.5 py-1 disabled:opacity-50 whitespace-nowrap"
                                      >
                                        ใช้ชำระหนี้นี้
                                      </button>
                                    </span>
                                  </div>
                                );
                              })}
                              {(linesOf.get(debt.id) ?? []).map((l) => {
                                const key = `${l.debtId}|l:${l.lineId}`;
                                return (
                                  <div
                                    key={key}
                                    className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm py-1"
                                  >
                                    <span className="num text-slate-500">
                                      {l.postedAt ? formatStatementDate(l.postedAt) : "—"}
                                    </span>
                                    <span className="num font-medium">{formatAmount(l.amount)}</span>
                                    {l.available < l.amount - 0.01 && (
                                      <span className="text-xs text-slate-500">
                                        (เหลือ {formatAmount(l.available)})
                                      </span>
                                    )}
                                    <span className="text-xs text-slate-500">
                                      เงินเข้าประจำวัน บัญชี {l.account}
                                      <span className="font-mono text-slate-400"> · {l.senderAccount}</span>
                                    </span>
                                    <span
                                      className={`text-xs ${l.contested ? "text-amber-700" : "text-emerald-700"}`}
                                    >
                                      {l.contested
                                        ? "ยังไม่อยู่ในรอบใด — แต่สมาชิกยังค้างรอบของเดือนที่โอน อาจเป็นยอดของเดือนนั้น ใช้ก็ต่อเมื่อแน่ใจ"
                                        : "ยังไม่อยู่ในรอบใด ไม่ได้นับให้ใคร"}
                                    </span>
                                    <span className="flex items-center gap-1.5 ml-auto">
                                      <input
                                        type="number"
                                        inputMode="decimal"
                                        step="0.01"
                                        value={applyAmounts[key] ?? String(l.suggested)}
                                        onChange={(e) =>
                                          setApplyAmounts((prev) => ({ ...prev, [key]: e.target.value }))
                                        }
                                        className="border border-slate-300 rounded px-2 py-1 text-xs w-24"
                                      />
                                      <button
                                        onClick={() => applyLine(debt, l)}
                                        disabled={busy || !(Number(applyAmounts[key] ?? l.suggested) > 0)}
                                        className="text-xs text-white bg-sky-700 rounded px-2.5 py-1 disabled:opacity-50 whitespace-nowrap"
                                      >
                                        ใช้ชำระหนี้นี้
                                      </button>
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        <div className="flex flex-wrap items-center gap-2 pt-2 mt-1 border-t border-slate-200">
                          <span className="text-xs text-slate-500">บันทึกชำระเงินสด ยอด</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            value={cashAmount}
                            onChange={(e) => setCashAmount(e.target.value)}
                            className="border border-slate-300 rounded px-2 py-1 text-xs w-24"
                          />
                          <span className="text-xs text-slate-500">วันที่</span>
                          <DateField
                            value={cashDate}
                            onChange={setCashDate}
                            className="border border-slate-300 rounded px-2 py-1 text-xs"
                          />
                          <input
                            type="text"
                            value={cashNote}
                            onChange={(e) => setCashNote(e.target.value)}
                            placeholder="หมายเหตุ (ถ้ามี)"
                            className="border border-slate-300 rounded px-2 py-1 text-xs w-40"
                          />
                          <button
                            onClick={() => recordCash(debt)}
                            disabled={busy || !(Number(cashAmount) > 0)}
                            className="text-xs text-white bg-slate-900 rounded px-2.5 py-1 disabled:opacity-50"
                          >
                            บันทึกเงินสด
                          </button>
                          <p className="w-full text-xs text-slate-400">
                            เงินโอนไม่ต้องบันทึกเป็นเงินสด — ใช้ปุ่ม &quot;ใช้ชำระหนี้นี้&quot; ด้านบน หรือกด
                            &quot;ชำระข้ามเดือน&quot; ที่รายการโอนในรอบที่เงินเข้ามา ระบบจะไม่นับซ้ำ
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
