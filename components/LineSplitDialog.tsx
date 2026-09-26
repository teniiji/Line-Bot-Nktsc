"use client";

import { useEffect, useMemo, useState } from "react";
import { formatAmount, formatStatementDateTime } from "@/lib/format";

// Divides one bank line among several members — a unit's payroll office
// paying for its people in a single transfer. Opens on the members the same
// payer paid for last time (lib/unitPayer.ts), and more can be searched for
// and added. Each share goes to the member's round and the ธุรกรรม tab.

interface MemberInfo {
  memberNumber: string;
  name?: string | null;
  onRound?: boolean;
  status?: string | null;
  owed?: number | null;
  lastAmount?: number | null;
  amount?: number;
}

interface Context {
  line: { id: string; amount: number; postedAt: string | null; description: string; account: string };
  payer: { id: string; name: string } | null;
  suggestedName: string;
  round: { id: string; label: string } | null;
  remembered: MemberInfo[];
  existing: MemberInfo[];
  blocked: string | null;
}

interface Row {
  memberNumber: string;
  name: string | null;
  onRound: boolean | null;
  owed: number | null;
  amount: string;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export default function LineSplitDialog({
  lineId,
  onClose,
  onSaved,
}: {
  lineId: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [context, setContext] = useState<Context | null>(null);
  const [payerName, setPayerName] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<{ memberNumber: string; memberName: string | null }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/statement-lines/${lineId}/split`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "โหลดข้อมูลไม่สำเร็จ");
        return;
      }
      const ctx = body as Context;
      setContext(ctx);
      setPayerName(ctx.payer?.name ?? ctx.suggestedName);
      // A split already made is edited as it stands; otherwise the members
      // this payer paid for last time, at what each paid then.
      const start = ctx.existing.length ? ctx.existing : ctx.remembered;
      setRows(
        start.map((m) => ({
          memberNumber: m.memberNumber,
          name: m.name ?? null,
          onRound: m.onRound ?? null,
          owed: m.owed ?? null,
          amount: String(m.amount ?? m.lastAmount ?? m.owed ?? ""),
        }))
      );
    })();
  }, [lineId]);

  // Searching the roster to add somebody not on last time's list.
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/member-roster?search=${encodeURIComponent(q)}&pageSize=8`);
      const body = await res.json().catch(() => ({}));
      setResults(
        (body.data ?? []).map((m: { memberNumber: string; memberName: string | null }) => ({
          memberNumber: m.memberNumber,
          memberName: m.memberName,
        }))
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const total = context?.line.amount ?? 0;
  const sum = useMemo(
    () => round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)),
    [rows]
  );
  const left = round2(total - sum);

  const addMember = (memberNumber: string, name: string | null) => {
    if (rows.some((r) => r.memberNumber === memberNumber)) return;
    setRows((prev) => [
      ...prev,
      { memberNumber, name, onRound: null, owed: null, amount: left > 0 ? String(left) : "" },
    ]);
    setSearch("");
    setResults([]);
  };

  // Everyone the same, the last one taking whatever the satang leave over.
  const splitEvenly = () => {
    if (rows.length === 0) return;
    const each = Math.floor((total / rows.length) * 100) / 100;
    setRows((prev) =>
      prev.map((r, i) => ({
        ...r,
        amount: String(i === prev.length - 1 ? round2(total - each * (prev.length - 1)) : each),
      }))
    );
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/statement-lines/${lineId}/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payerName,
          parts: rows.map((r) => ({ memberNumber: r.memberNumber, amount: Number(r.amount) })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "บันทึกไม่สำเร็จ");
        return;
      }
      const placed = (body.placed ?? []).length;
      const missing: string[] = body.notOnRound ?? [];
      onSaved(
        `แบ่งยอด ${formatAmount(total)} ของ ${body.payerName} ให้สมาชิก ${rows.length} คนแล้ว` +
          (body.roundLabel ? ` — นับในรอบ ${body.roundLabel} ${placed} คน` : " — ยังไม่มีรอบที่เปิดของเดือนนี้ จึงยังไม่ได้นับในรอบ") +
          (missing.length ? ` · ไม่อยู่ในรอบ: ${missing.join(", ")} (บันทึกเป็นรายการในแถบธุรกรรมอย่างเดียว)` : "")
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-lg p-5 max-w-3xl w-full space-y-3 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-lg">แบ่งยอดให้สมาชิกหลายคน</h3>
        {!context ? (
          <p className="text-sm text-slate-500">{error ?? "กำลังโหลด…"}</p>
        ) : (
          <>
            <div className="text-sm text-slate-600">
              <span className="num font-semibold text-slate-900">{formatAmount(total)}</span>
              {context.line.postedAt && (
                <span className="num"> · {formatStatementDateTime(context.line.postedAt)}</span>
              )}
              <span className="font-mono text-xs text-slate-500"> · {context.line.description}</span>
              <div className="text-xs text-slate-500 mt-0.5">
                {context.round
                  ? `แต่ละคนจะนับในรอบ ${context.round.label} และลงเป็นรายการในแถบธุรกรรม`
                  : "ยังไม่มีรอบที่เปิดอยู่ของเดือนนี้ — จะลงเป็นรายการในแถบธุรกรรมอย่างเดียว"}
              </div>
            </div>
            {context.blocked && (
              <p className="text-sm text-red-700 bg-red-50 rounded px-3 py-2">{context.blocked}</p>
            )}
            <label className="text-sm block">
              <span className="text-slate-600">ชื่อหน่วยงาน (ระบบจำไว้ ครั้งหน้าจะขึ้นชื่อนี้และรายชื่อสมาชิกเดิมให้)</span>
              <input
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                className="mt-1 w-full border border-slate-300 rounded px-3 py-1.5"
                placeholder="เช่น สพป.กาฬสินธุ์ เขต 2"
              />
            </label>

            <div className="overflow-auto border border-slate-200 rounded min-h-0 flex-1">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-left text-xs sticky top-0">
                  <tr>
                    <th className="px-2 py-2 font-semibold">สมาชิก</th>
                    <th className="px-2 py-2 font-semibold">ในรอบ</th>
                    <th className="px-2 py-2 font-semibold text-right">ยอดที่แบ่งให้</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-3 text-slate-400 text-center">
                        ยังไม่มีรายชื่อ — ค้นหาด้านล่างเพื่อเพิ่มสมาชิก
                      </td>
                    </tr>
                  )}
                  {rows.map((r, i) => (
                    <tr key={r.memberNumber} className="border-t border-slate-100">
                      <td className="px-2 py-1.5">
                        <span className="num">{r.memberNumber}</span> {r.name ?? ""}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-slate-500">
                        {r.onRound === false
                          ? "ไม่อยู่ในรอบ"
                          : r.owed === null
                            ? "—"
                            : r.owed > 0
                              ? `ค้าง/แจ้งหัก ${formatAmount(r.owed)}`
                              : "ไม่มียอดค้างในรอบ"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          value={r.amount}
                          onChange={(e) =>
                            setRows((prev) => prev.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
                          }
                          className="border border-slate-300 rounded px-2 py-1 text-sm w-28 text-right"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                          className="text-xs text-red-700 hover:underline"
                        >
                          เอาออก
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="relative">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="➕ เพิ่มสมาชิก: ค้นหาเลขสมาชิกหรือชื่อ"
                className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm"
              />
              {results.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded shadow max-h-48 overflow-auto">
                  {results.map((m) => (
                    <button
                      key={m.memberNumber}
                      onClick={() => addMember(m.memberNumber, m.memberName)}
                      className="block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50"
                    >
                      <span className="num">{m.memberNumber}</span> {m.memberName ?? ""}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>
                รวม <strong className="num">{formatAmount(sum)}</strong> จาก{" "}
                <span className="num">{formatAmount(total)}</span>
              </span>
              <span className={`num ${Math.abs(left) < 0.01 ? "text-emerald-700" : "text-amber-700"}`}>
                {Math.abs(left) < 0.01 ? "✅ ครบพอดี" : left > 0 ? `เหลืออีก ${formatAmount(left)}` : `เกิน ${formatAmount(-left)}`}
              </span>
              <button
                onClick={splitEvenly}
                disabled={rows.length === 0}
                className="text-xs border border-slate-300 rounded px-2 py-1 disabled:opacity-50 sm:ml-auto"
              >
                แบ่งเท่ากันทุกคน
              </button>
            </div>
            {error && <p className="text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="border border-slate-300 rounded px-4 py-2 text-sm font-medium">
                ยกเลิก
              </button>
              <button
                onClick={save}
                disabled={busy || rows.length === 0 || Math.abs(left) >= 0.01 || !!context.blocked}
                className="rounded px-4 py-2 text-sm font-medium text-white bg-emerald-700 disabled:opacity-50"
              >
                บันทึกการแบ่ง
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
