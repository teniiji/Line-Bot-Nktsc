"use client";

import { useEffect, useMemo, useState } from "react";
import type { CarriedDebtRow } from "@/lib/types";
import { memberNumberKey } from "@/lib/memberNumber";
import { formatAmount } from "@/lib/format";

// Puts some or all of one transfer toward a member's carried debt
// (ชำระข้ามเดือน) instead of the round it arrived in. Staff pick the debt
// every time — the cooperative has no rule that money pays the oldest month
// first — so this only narrows the list to the member's own open debts and
// suggests an amount.
export default function CarryToDebtForm({
  roundId,
  transfer,
  defaultMemberNumber,
  openDebts,
  onDone,
}: {
  roundId: string;
  transfer: { id: string; amount: number; carriedAmount: number };
  // The member the transfer is already matched or bound to; blank for money
  // nobody has placed, where staff type the number themselves.
  defaultMemberNumber: string | null;
  openDebts: CarriedDebtRow[];
  onDone: () => Promise<void>;
}) {
  const available = Math.round((transfer.amount - transfer.carriedAmount) * 100) / 100;
  const [memberInput, setMemberInput] = useState(defaultMemberNumber ?? "");
  const [debtId, setDebtId] = useState("");
  const [amountInput, setAmountInput] = useState(String(available));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debts = useMemo(() => {
    const key = memberNumberKey(memberInput);
    return key ? openDebts.filter((d) => memberNumberKey(d.memberNumber) === key) : [];
  }, [memberInput, openDebts]);

  const outstandingOf = (debt: CarriedDebtRow) =>
    Math.round((debt.amount - debt.amountPaid) * 100) / 100;

  // Oldest first in the list, and the first one picked, only because that is
  // the order people read months in — not a rule about which gets paid.
  const ordered = [...debts].reverse();

  useEffect(() => {
    const first = ordered[0];
    setDebtId(first?.id ?? "");
    setAmountInput(String(first ? Math.min(available, outstandingOf(first)) : available));
    // Only when the member changes, not on every amount keystroke.
  }, [memberInput, openDebts]);

  const chooseDebt = (id: string) => {
    setDebtId(id);
    const debt = debts.find((d) => d.id === id);
    if (debt) setAmountInput(String(Math.min(available, outstandingOf(debt))));
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/statement-rounds/${roundId}/transfers/${transfer.id}/carry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ debtId, amount: Number(amountInput) }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "ย้ายไปชำระข้ามเดือนไม่สำเร็จ");
        return;
      }
      await onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full flex flex-wrap items-center gap-2 pt-1 pl-1 border-t border-dashed border-amber-200 mt-1">
      <span className="text-xs text-slate-500">ชำระหนี้ข้ามเดือนของเลขสมาชิก</span>
      <input
        type="text"
        value={memberInput}
        onChange={(e) => setMemberInput(e.target.value)}
        placeholder="เลขสมาชิก"
        className="border border-slate-300 rounded px-2 py-1 text-xs w-24"
        autoFocus={!defaultMemberNumber}
      />
      {debts.length > 0 ? (
        <>
          <select
            value={debtId}
            onChange={(e) => chooseDebt(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1 text-xs"
          >
            {ordered.map((debt) => (
              <option key={debt.id} value={debt.id}>
                {debt.sourceLabel} — ค้าง {formatAmount(outstandingOf(debt))}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500">ยอด</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1 text-xs w-24"
          />
          <button
            type="button"
            onClick={submit}
            disabled={busy || !debtId}
            className="text-xs text-white bg-amber-700 rounded px-2.5 py-1 disabled:opacity-50"
          >
            ย้ายไปชำระข้ามเดือน
          </button>
        </>
      ) : (
        <span className="text-xs text-slate-400">
          {memberNumberKey(memberInput)
            ? "เลขสมาชิกนี้ไม่มีหนี้ข้ามเดือนที่ยังค้าง"
            : "พิมพ์เลขสมาชิกเจ้าของหนี้"}
        </span>
      )}
      {error && <p className="w-full text-xs text-red-600">{error}</p>}
      <p className="w-full text-xs text-slate-400">
        ยอดที่ย้ายจะไม่นับในรอบนี้แล้ว ไปนับที่แถบ &quot;ชำระข้ามเดือน&quot; แทน · รายการนี้ย้ายได้อีก{" "}
        {formatAmount(available)} · ย้อนกลับได้ที่แถบชำระข้ามเดือน
      </p>
    </div>
  );
}
