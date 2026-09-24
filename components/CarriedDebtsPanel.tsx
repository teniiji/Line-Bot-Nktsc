"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { CarriedDebtRow } from "@/lib/types";
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

  const fetchDebts = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/carried-debts");
    const body = await res.json().catch(() => ({}));
    setDebts(body.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDebts();
  }, [fetchDebts]);

  // The months on offer, newest first, from the debts themselves — a closed
  // round nobody owed anything on has nothing to show here.
  const months = useMemo(() => {
    const seen = new Map<string, string>();
    for (const d of debts) if (!seen.has(d.sourceRoundId)) seen.set(d.sourceRoundId, d.sourceLabel);
    return [...seen.entries()];
  }, [debts]);

  const inMonth = debts.filter((d) => !month || d.sourceRoundId === month);
  const counts = {
    all: inMonth.length,
    unpaid: inMonth.filter((d) => d.status === "unpaid").length,
    paid: inMonth.filter((d) => d.status === "paid").length,
    overpaid: inMonth.filter((d) => d.status === "overpaid").length,
  };
  const needle = search.trim().toLowerCase();
  const shown = inMonth
    .filter((d) => status === "all" || d.status === status)
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
      await fetchDebts();
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
      await fetchDebts();
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
                                  โอน · จากรอบ {p.roundLabel ?? "—"}
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
                            เงินโอนไม่ต้องบันทึกที่นี่ — กด &quot;ชำระข้ามเดือน&quot; ที่รายการโอนในรอบที่เงินเข้ามา
                            ระบบจะไม่นับซ้ำ
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
