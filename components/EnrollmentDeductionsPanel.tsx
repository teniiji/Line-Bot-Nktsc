"use client";

import { useCallback, useEffect, useState } from "react";
import { ENROLLMENT_PRODUCTS, PAYMENT_METHODS, type EnrollmentProduct } from "@/lib/enrollment";
import { DEDUCTION_PRODUCTS, byUnit, periodOfMonth } from "@/lib/enrollmentDeductions";

// รายการหัก / เก็บเงิน — what the monthly รายการหัก has to change because of
// applications and cancellations, the life premiums still to collect, and who
// applied but was หักไม่ได้. See lib/enrollmentDeductions.ts.

interface Row {
  id: string;
  memberNumber: string;
  memberName: string | null;
  unitName: string | null;
  product: EnrollmentProduct;
  action: string;
  status: string;
  applicationDate: string;
  relativeName: string | null;
  deductionPeriod: string | null;
  paymentMethod: keyof typeof PAYMENT_METHODS | null;
  proratedPremium: number | null;
  annualPremium: number | null;
  premiumPaidAt: string | null;
  roundLabel?: string;
}

interface Data {
  add: Row[];
  remove: Row[];
  premiums: Row[];
  undeducted: Row[];
  roundsChecked: string[];
  fees: Record<string, number | null>;
}

const baht = (x: number | null | undefined) => (x == null ? "—" : x.toLocaleString("th-TH"));
const thaiDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("th-TH", { timeZone: "UTC", day: "numeric", month: "short", year: "2-digit" }) : "—";
const input = "border border-slate-300 rounded px-2 py-1.5 text-sm bg-white";

function nextMonth(): string {
  const now = new Date(Date.now() + 7 * 3600_000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return d.toISOString().slice(0, 7);
}

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function download(name: string, header: string[], lines: unknown[][]) {
  const text = "﻿" + [header.join(","), ...lines.map((l) => l.map(csvCell).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
}

const productLabel = (r: Row) =>
  `${ENROLLMENT_PRODUCTS[r.product]}${r.relativeName ? ` (${r.relativeName})` : ""}`;

export default function EnrollmentDeductionsPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [month, setMonth] = useState(nextMonth());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fees, setFees] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The rows just marked, so a mark in the wrong month can be taken back.
  const [lastMarked, setLastMarked] = useState<string[]>([]);

  const load = useCallback(async () => {
    const res = await fetch("/api/enrollments/deduction");
    const body: Data = await res.json();
    setData(body);
    setFees(Object.fromEntries(DEDUCTION_PRODUCTS.map((p) => [p, body.fees[p] == null ? "" : String(body.fees[p])])));
    setSelected(new Set());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const period = periodOfMonth(month);
  const feeOf = (r: Row) => (data?.fees[r.product] ?? null);

  const saveFees = async () => {
    setError(null);
    const res = await fetch("/api/enrollments/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fees }),
    });
    if (!res.ok) return setError((await res.json()).error ?? "บันทึกไม่สำเร็จ");
    setNotice("บันทึกค่าบำรุงรายเดือนแล้ว");
    setLastMarked([]);
    load();
  };

  const markPlaced = async (ids: string[]) => {
    if (!period || ids.length === 0) return;
    const res = await fetch("/api/enrollments/deduction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, period }),
    });
    const body = await res.json();
    if (!res.ok) return setError(body.error);
    setNotice(`ทำเครื่องหมายว่าใส่ในรายการหักเดือน ${period} แล้ว ${body.updated} รายการ`);
    setLastMarked(ids);
    load();
  };

  const undoMark = async () => {
    const res = await fetch("/api/enrollments/deduction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: lastMarked, period: null }),
    });
    const body = await res.json();
    if (!res.ok) return setError(body.error);
    setNotice(`เลิกทำแล้ว ${body.updated} รายการ กลับมาอยู่ในรายการที่ต้องแก้`);
    setLastMarked([]);
    load();
  };

  const markPaid = async (ids: string[]) => {
    const res = await fetch("/api/enrollments/premium", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, paid: true }),
    });
    const body = await res.json();
    if (!res.ok) return setError(body.error);
    setNotice(`บันทึกว่าเก็บเบี้ยแล้ว ${body.updated} ราย`);
    setLastMarked([]);
    load();
  };

  const exportChanges = () => {
    if (!data) return;
    const rows = [...data.add, ...data.remove];
    download(
      `แก้รายการหัก_${period ?? month}.csv`,
      ["หน่วยงาน", "เลขสมาชิก", "ชื่อ-สกุล", "เพิ่ม/ตัด", "รายการ", "ค่าบำรุง/เดือน", "วันที่สมัคร", "สถานะ"],
      byUnit(rows).flatMap(([unit, list]) =>
        list.map((r) => [
          unit, r.memberNumber, r.memberName, r.action === "cancel" ? "ตัดออก" : "เพิ่ม", productLabel(r),
          feeOf(r), r.applicationDate.slice(0, 10), r.status === "approved" ? "อนุมัติแล้ว" : "รออนุมัติ",
        ])
      )
    );
  };

  const exportPremiums = () => {
    if (!data) return;
    download(
      "เบี้ยประกันที่ต้องเก็บ.csv",
      ["เลขสมาชิก", "ชื่อ-สกุล", "หน่วยงาน", "วิธีชำระ", "เบี้ยตามสัดส่วน", "เบี้ยทั้งปี", "วันที่สมัคร"],
      data.premiums.map((r) => [
        r.memberNumber, r.memberName, r.unitName, r.paymentMethod ? PAYMENT_METHODS[r.paymentMethod] : "",
        r.proratedPremium, r.annualPremium, r.applicationDate.slice(0, 10),
      ])
    );
  };

  if (!data) return <p className="text-sm text-slate-500">กำลังโหลด…</p>;

  const changeGroups = byUnit([...data.add, ...data.remove]);
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const byMethod = (m: string) => data.premiums.filter((r) => (r.paymentMethod ?? "") === m);

  return (
    <div className="space-y-6">
      {notice && (
        <p className="text-sm text-emerald-700 bg-emerald-50 rounded px-3 py-2">
          {notice}
          {lastMarked.length > 0 && (
            <button type="button" onClick={undoMark} className="ml-3 underline hover:text-emerald-900">
              เลิกทำ
            </button>
          )}
        </p>
      )}
      {error && <p className="text-sm text-red-700 bg-red-50 rounded px-3 py-2">{error}</p>}

      <section className="bg-white rounded-lg shadow p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">ต้องแก้ในรายการหัก</h3>
            <p className="text-xs text-slate-500">
              การสมัคร/ยกเลิกฌาปนกิจและญาติที่ยังไม่ได้ใส่ในรายการหัก (ไม่รวมที่ไม่อนุมัติ) แยกตามหน่วยงานแบบไฟล์รายการหัก —
              ใส่ในไฟล์แล้วติ๊กเลือก แล้วกด &quot;ใส่ในรายการหักเดือนนี้แล้ว&quot; เดือนถัดไปจะเหลือเฉพาะที่ยังค้าง
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">รายการหักเดือน</span>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={input} />
            <span className="num text-slate-500">({period ?? "—"})</span>
            <button
              type="button"
              disabled={selected.size === 0 || !period}
              onClick={() => markPlaced([...selected])}
              className="px-3 py-1.5 rounded bg-slate-900 text-white disabled:opacity-40"
            >
              ใส่ในรายการหักเดือนนี้แล้ว ({selected.size})
            </button>
            <button
              type="button"
              disabled={changeGroups.length === 0}
              onClick={exportChanges}
              className="px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-40"
            >
              ส่งออก CSV
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">ค่าบำรุงหักรายเดือน (บาท):</span>
          {DEDUCTION_PRODUCTS.map((p) => (
            <label key={p} className="flex items-center gap-1">
              <span className="text-slate-600">{ENROLLMENT_PRODUCTS[p]}</span>
              <input
                inputMode="decimal"
                value={fees[p] ?? ""}
                onChange={(e) => setFees((f) => ({ ...f, [p]: e.target.value.replace(/[^\d.]/g, "") }))}
                className={`${input} w-20`}
              />
            </label>
          ))}
          <button type="button" onClick={saveFees} className="px-2 py-1 text-xs rounded border border-slate-300 hover:bg-slate-50">
            บันทึก
          </button>
        </div>

        {changeGroups.length === 0 ? (
          <p className="text-sm text-slate-400 py-3 text-center">ไม่มีรายการที่ต้องแก้ในรายการหัก</p>
        ) : (
          <div className="space-y-3">
            {changeGroups.map(([unit, list]) => (
              <div key={unit} className="border border-slate-200 rounded">
                <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 text-sm">
                  <span className="font-medium">{unit}</span>
                  <button
                    type="button"
                    className="text-xs text-sky-700 hover:underline"
                    onClick={() => setSelected((prev) => new Set([...prev, ...list.map((r) => r.id)]))}
                  >
                    เลือกทั้งหน่วย
                  </button>
                </div>
                <table className="w-full text-sm table-fixed">
                  <colgroup>
                    <col className="w-10" />
                    <col className="w-20" />
                    <col className="w-44" />
                    <col />
                    <col className="w-32" />
                    <col className="w-52" />
                  </colgroup>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="px-3 py-1.5">
                          <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                        </td>
                        <td className="num">{r.memberNumber}</td>
                        <td className="truncate">{r.memberName}</td>
                        <td className={r.action === "cancel" ? "text-red-700" : "text-blue-800"}>
                          {r.action === "cancel" ? "ตัดออก" : "เพิ่ม"} {productLabel(r)}
                        </td>
                        <td className="text-right num pr-3">{feeOf(r) != null ? `${baht(feeOf(r))} บาท/เดือน` : ""}</td>
                        <td className="text-xs text-slate-500 pr-3 whitespace-nowrap">
                          สมัคร {thaiDate(r.applicationDate)} · {r.status === "approved" ? "อนุมัติแล้ว" : "รออนุมัติ"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-white rounded-lg shadow p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">เบี้ยประกันชีวิตที่ต้องเก็บ</h3>
            <p className="text-xs text-slate-500">
              เบี้ยตามสัดส่วนของผู้สมัครที่ยังไม่ได้บันทึกว่าเก็บแล้ว — &quot;หักจากเงินกู้&quot; ส่งให้ฝ่ายสินเชื่อหักตอนจ่ายเงินกู้,
              &quot;จ่ายเอง&quot; รอสมาชิกชำระ
            </p>
          </div>
          <button
            type="button"
            disabled={data.premiums.length === 0}
            onClick={exportPremiums}
            className="px-3 py-1.5 text-sm rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-40"
          >
            ส่งออก CSV ({data.premiums.length})
          </button>
        </div>
        {data.premiums.length === 0 ? (
          <p className="text-sm text-slate-400 py-3 text-center">ไม่มีเบี้ยค้างเก็บ</p>
        ) : (
          (["loan", "self", ""] as const).map((m) => {
            const list = byMethod(m);
            if (list.length === 0) return null;
            return (
              <div key={m || "none"}>
                <p className="text-sm font-medium mt-2">
                  {m ? PAYMENT_METHODS[m] : "ไม่ได้ระบุวิธีชำระ"} · {list.length} ราย · รวม{" "}
                  {baht(list.reduce((s, r) => s + (r.proratedPremium ?? 0), 0))} บาท
                </p>
                <table className="w-full text-sm mt-1">
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="num w-24 py-1.5">{r.memberNumber}</td>
                        <td>
                          {r.memberName}
                          <span className="block text-xs text-slate-400">{r.unitName}</span>
                        </td>
                        <td className="text-right num">
                          {baht(r.proratedPremium)}
                          {r.proratedPremium == null && <span className="block text-xs text-amber-700 font-sans">ยังไม่ได้ตั้งปีกรมธรรม์</span>}
                        </td>
                        <td className="text-xs text-slate-500 px-3 whitespace-nowrap">สมัคร {thaiDate(r.applicationDate)}</td>
                        <td className="text-right">
                          <button type="button" onClick={() => markPaid([r.id])} className="text-xs text-emerald-700 hover:underline">
                            เก็บแล้ว
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })
        )}
      </section>

      <section className="bg-white rounded-lg shadow p-4 space-y-2">
        <h3 className="font-semibold">สมัครแล้วแต่หักไม่ได้</h3>
        <p className="text-xs text-slate-500">
          ใส่ในรายการหักเดือนใดแล้ว และรอบหักไม่ได้ของเดือนนั้น (แท็บเทียบ Statement) ยังค้างชำระ — ค่าบำรุงใหม่ก็ยังไม่ได้เก็บ
          {data.roundsChecked.length > 0 ? ` · ตรวจรอบ: ${data.roundsChecked.join(", ")}` : " · ยังไม่มีรอบของเดือนที่ใส่รายการหักไว้"}
        </p>
        {data.undeducted.length === 0 ? (
          <p className="text-sm text-slate-400 py-3 text-center">ไม่มี</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {data.undeducted.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="num w-24 py-1.5">{r.memberNumber}</td>
                  <td>
                    {r.memberName}
                    <span className="block text-xs text-slate-400">{r.unitName}</span>
                  </td>
                  <td>{productLabel(r)}</td>
                  <td className="text-red-600 text-xs">หักไม่ได้รอบ {r.roundLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
