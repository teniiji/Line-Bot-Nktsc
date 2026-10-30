"use client";

import { useEffect, useMemo, useState } from "react";
import { formatAmount, formatStatementDateTime } from "@/lib/format";
import { parseDebitPaste } from "@/lib/debitPaste";

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
  // Units sharing this line's wording, when several do (lib/linePayer.ts).
  choices?: { id: string; name: string }[];
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

// One row of a pasted Direct Debit list, with the member its account
// belongs to when the system knows (lib/debitPaste.ts).
interface PastedRow {
  account: string;
  amount: number;
  name: string | null;
  memberNumber: string;
  memberName: string | null;
  onRound: boolean | null;
  owed: number | null;
  found: boolean;
  include: boolean;
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
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasted, setPasted] = useState<PastedRow[] | null>(null);
  const [pasteNote, setPasteNote] = useState<string | null>(null);

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

  // Reads the pasted list and finds who holds each account.
  const readPaste = async () => {
    const { rows: read, skipped } = parseDebitPaste(pasteText);
    if (read.length === 0) {
      setPasteNote("ไม่พบแถวที่มีเลขบัญชี 10 หลักกับยอดเงิน — ลอง copy คอลัมน์ชื่อ เลขบัญชี และยอด จาก Excel มาวาง");
      setPasted(null);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/statement-lines/${lineId}/split-accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: read.map((r) => r.account) }),
      });
      const body = await res.json().catch(() => ({}));
      const found: Record<
        string,
        { memberNumber: string; name?: string | null; onRound?: boolean; owed?: number | null }
      > = res.ok ? body.found ?? {} : {};
      setPasted(
        read.map((r) => {
          const m = found[r.account];
          return {
            ...r,
            memberNumber: m?.memberNumber ?? "",
            memberName: m?.name ?? null,
            onRound: m ? m.onRound ?? null : null,
            owed: m?.owed ?? null,
            found: !!m,
            include: true,
          };
        })
      );
      setPasteNote(skipped ? `ข้าม ${skipped} บรรทัดที่ไม่ใช่รายการ (หัวตาราง/ยอดรวม)` : null);
    } finally {
      setBusy(false);
    }
  };

  const pastedSum = round2(
    (pasted ?? []).filter((r) => r.include).reduce((s, r) => s + r.amount, 0)
  );
  const pastedMissing = (pasted ?? []).filter((r) => r.include && !r.memberNumber.trim()).length;

  // The ticked rows become the division, replacing whatever was listed —
  // a Direct Debit is its own list, not last month's members plus some.
  const usePaste = () => {
    if (!pasted) return;
    const merged = new Map<string, Row>();
    for (const r of pasted) {
      if (!r.include || !r.memberNumber.trim()) continue;
      const key = r.memberNumber.trim();
      const prev = merged.get(key);
      merged.set(key, {
        memberNumber: key,
        name: r.memberName ?? r.name,
        onRound: r.onRound,
        owed: r.owed,
        amount: String(round2((prev ? Number(prev.amount) : 0) + r.amount)),
      });
    }
    setRows([...merged.values()]);
    setPasted(null);
    setPasteText("");
    setPasteOpen(false);
    setPasteNote(null);
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
                list={context.choices?.length ? "split-payer-choices" : undefined}
                className="mt-1 w-full border border-slate-300 rounded px-3 py-1.5"
                placeholder="เช่น สพป.กาฬสินธุ์ เขต 2"
              />
              {(context.choices?.length ?? 0) > 0 && (
                <datalist id="split-payer-choices">
                  {context.choices!.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
              )}
              <span className="block text-xs text-slate-500 mt-1">
                {(context.choices?.length ?? 0) > 1
                  ? `ข้อความในสเตทเมนต์นี้ใช้ร่วมกับ ${context.choices!.length} หน่วยงาน (${context.choices!
                      .map((c) => c.name)
                      .join(", ")}) — เลือกชื่อให้ตรง ถ้าพิมพ์ชื่อใหม่จะเป็นหน่วยงานใหม่`
                  : "ถ้าพิมพ์ชื่ออื่น จะเพิ่มเป็นหน่วยงานใหม่ (ใช้เมื่อหน่วยงานคนละแห่งแต่ข้อความในสเตทเมนต์เหมือนกัน) — แก้ชื่อหน่วยงานเดิมได้ที่ปุ่ม \"แก้ชื่อ\""}
              </span>
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

            {pasteOpen && (
              <div className="border border-sky-200 bg-sky-50/50 rounded p-3 space-y-2 text-sm">
                <p className="text-slate-600">
                  วางรายการจาก Excel หรือใบ Direct Debit ของธนาคาร — ต้องมี<strong>เลขบัญชี 10 หลัก</strong>กับ
                  <strong>ยอด</strong>ในแต่ละแถว (มีชื่อด้วยก็ได้) ระบบจะหาเลขสมาชิกจากเลขบัญชีให้
                </p>
                {!pasted ? (
                  <>
                    <textarea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      rows={6}
                      placeholder={"นางสิริเกศ คิสาลัง\t4300009414\t2500\nนายพิศาล พรหมจักร์\t4301387595\t5600"}
                      className="w-full border border-slate-300 rounded px-2 py-1 font-mono text-xs"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={readPaste}
                        disabled={busy || !pasteText.trim()}
                        className="rounded px-3 py-1.5 text-white bg-sky-700 disabled:opacity-50"
                      >
                        อ่านรายการ
                      </button>
                      <button onClick={() => setPasteOpen(false)} className="border border-slate-300 rounded px-3 py-1.5">
                        ปิด
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="overflow-auto max-h-64 border border-slate-200 rounded bg-white">
                      <table className="w-full text-xs">
                        <thead className="text-slate-500 text-left">
                          <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:bg-slate-50 [&>th]:z-10">
                            <th className="px-2 py-1.5" />
                            <th className="px-2 py-1.5 font-semibold">เลขบัญชี · ชื่อในไฟล์</th>
                            <th className="px-2 py-1.5 font-semibold">สมาชิก</th>
                            <th className="px-2 py-1.5 font-semibold text-right">ยอด</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pasted.map((r, i) => (
                            <tr key={`${r.account}-${i}`} className={`border-t border-slate-100 ${r.include ? "" : "opacity-40"}`}>
                              <td className="px-2 py-1">
                                <input
                                  type="checkbox"
                                  checked={r.include}
                                  aria-label={`ใช้แถว ${r.account}`}
                                  onChange={(e) =>
                                    setPasted((prev) =>
                                      prev!.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x))
                                    )
                                  }
                                />
                              </td>
                              <td className="px-2 py-1">
                                <span className="num font-mono">{r.account}</span>{" "}
                                <span className="text-slate-500">{r.name ?? ""}</span>
                              </td>
                              <td className="px-2 py-1">
                                {r.found ? (
                                  <>
                                    <span className="num">{r.memberNumber}</span> {r.memberName ?? ""}
                                    {r.onRound === false && <span className="text-amber-700"> · ไม่อยู่ในรอบ</span>}
                                    {r.owed !== null && r.owed > 0 && (
                                      <span className="text-slate-500"> · ค้าง {formatAmount(r.owed)}</span>
                                    )}
                                  </>
                                ) : (
                                  <input
                                    value={r.memberNumber}
                                    inputMode="numeric"
                                    // The number alone: a name typed or
                                    // pasted after it would be saved as part
                                    // of the member number (lib/unitPayer.ts).
                                    onChange={(e) => {
                                      const digits = e.target.value.match(/\d+/)?.[0] ?? "";
                                      setPasted((prev) =>
                                        prev!.map((x, j) => (j === i ? { ...x, memberNumber: digits } : x))
                                      );
                                    }}
                                    placeholder="ไม่พบบัญชีนี้ — ใส่เลขสมาชิก"
                                    className="border border-amber-300 bg-amber-50 rounded px-2 py-0.5 w-48"
                                  />
                                )}
                              </td>
                              <td className="px-2 py-1 text-right num">{formatAmount(r.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span>
                        ติ๊กไว้ {pasted.filter((r) => r.include).length} แถว รวม{" "}
                        <strong className="num">{formatAmount(pastedSum)}</strong> จาก{" "}
                        <span className="num">{formatAmount(total)}</span>
                      </span>
                      <span className={`num ${Math.abs(pastedSum - total) < 0.01 ? "text-emerald-700" : "text-amber-700"}`}>
                        {Math.abs(pastedSum - total) < 0.01
                          ? "✅ ตรงกับยอดเงินเข้า"
                          : pastedSum > total
                            ? `เกิน ${formatAmount(pastedSum - total)} — ติ๊กออกคนที่ธนาคารหักไม่สำเร็จ (Insufficient funds / Closed)`
                            : `ขาด ${formatAmount(total - pastedSum)}`}
                      </span>
                    </div>
                    {pastedMissing > 0 && (
                      <p className="text-amber-800">
                        ยังไม่รู้เลขสมาชิก {pastedMissing} แถว — ใส่เลขสมาชิก หรือติ๊กออก
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={usePaste}
                        disabled={pastedMissing > 0 || !pasted.some((r) => r.include)}
                        className="rounded px-3 py-1.5 text-white bg-sky-700 disabled:opacity-50"
                      >
                        ใช้รายการนี้แบ่งยอด
                      </button>
                      <button onClick={() => setPasted(null)} className="border border-slate-300 rounded px-3 py-1.5">
                        วางใหม่
                      </button>
                    </div>
                  </>
                )}
                {pasteNote && <p className="text-xs text-slate-500">{pasteNote}</p>}
              </div>
            )}

            {!pasteOpen && (
              <button
                onClick={() => setPasteOpen(true)}
                className="self-start text-sm border border-sky-300 text-sky-800 rounded px-3 py-1.5 hover:bg-sky-50"
              >
                📋 วางรายการจาก Excel / ใบ Direct Debit
              </button>
            )}

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
