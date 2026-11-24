"use client";

import { useEffect, useMemo, useState } from "react";
import { buildLoanSchedule, type LoanSchedule } from "@/lib/loanSchedule";
import { formatThaiDay } from "@/lib/format";
import { cooperativeToday } from "@/lib/cooperativeClock";
import PanelHelp from "@/components/PanelHelp";
import DateField from "@/components/DateField";

// ตารางผ่อนชำระ — a calculator staff use while a member is on the line
// asking "if I borrow this much, what do I pay each month?". Nothing here is
// saved to the database; the inputs are remembered in this browser only, so
// the tab opens where it was left.

type Mode = "months" | "payment";

interface Inputs {
  principal: string;
  rate: string;
  months: string;
  payment: string;
  startDay: string;
  mode: Mode;
}

const STORAGE_KEY = "loan-schedule-v1";
const defaults = (): Inputs => ({
  principal: "185,000",
  rate: "1",
  months: "360",
  payment: "",
  startDay: cooperativeToday(),
  mode: "months",
});

const baht = (x: number) => x.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parseNumber = (v: string) => {
  const x = parseFloat(v.replace(/,/g, ""));
  return Number.isFinite(x) ? x : NaN;
};

// Thousands separators as the amount is typed: "200000" reads "200,000".
// At most two decimals; anything that is not a digit or the point is dropped.
function groupDigits(raw: string): string {
  let v = raw.replace(/[^\d.]/g, "");
  const dot = v.indexOf(".");
  if (dot >= 0) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "").slice(0, 2);
  const [whole, frac] = v.split(".");
  const grouped = (whole ?? "").replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
}

const escapeHtml = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const COLUMNS = ["งวดที่", "วันที่ชำระ", "เงินต้นยกมา", "ชำระเงินต้น", "ดอกเบี้ย", "ยอดชำระงวดนี้", "เงินต้นคงเหลือ"];

function printDocument(s: LoanSchedule, inputs: Inputs): string {
  const first = s.rows[0];
  const last = s.rows[s.rows.length - 1];
  const info: [string, string][] = [
    ["เงินต้น", `${baht(parseNumber(inputs.principal))} บาท`],
    ["อัตราดอกเบี้ย", `${escapeHtml(inputs.rate)}% ต่อปี`],
    ["ยอดชำระต่องวด", `${baht(s.payment)} บาท`],
    ["จำนวนงวด", `${s.rows.length} งวด`],
    ["งวดแรก", formatThaiDay(first.day)],
    ["งวดสุดท้าย", formatThaiDay(last.day)],
    ["ดอกเบี้ยรวม", `${baht(s.totalInterest)} บาท`],
    ["ชำระรวมทั้งสิ้น", `${baht(s.totalPaid)} บาท`],
  ];
  const body = s.rows
    .map(
      (r) =>
        `<tr><td>${r.period}</td><td class="d">${formatThaiDay(r.day)}</td><td>${baht(r.opening)}</td><td>${baht(
          r.principalPaid,
        )}</td><td>${baht(r.interest)}</td><td>${baht(r.amount)}</td><td>${baht(r.closing)}</td></tr>`,
    )
    .join("");
  return `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>ตารางผ่อนชำระหนี้</title>
<style>@page{size:A4;margin:14mm 12mm}body{font:13px/1.4 Sarabun,Tahoma,sans-serif;color:#000;margin:0}
h1{font-size:20px;margin:0 0 8px}.info{display:grid;grid-template-columns:repeat(4,1fr);gap:4px 16px;margin-bottom:12px}
.info b{display:block}table{width:100%;border-collapse:collapse}th,td{border:1px solid #888;padding:3px 6px;text-align:right;white-space:nowrap}
th{background:#e6ebf3}thead{display:table-header-group}tr{break-inside:avoid}td:first-child,th:first-child{text-align:center}
.d{text-align:left}tfoot td{font-weight:700}.note{margin-top:8px;font-size:11px;color:#444}</style></head><body>
<h1>ตารางผ่อนชำระหนี้ แบบต้นรวมดอก</h1>
<div class="info">${info.map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join("")}</div>
<table><thead><tr>${COLUMNS.map((c, i) => `<th${i === 1 ? ' class="d"' : ""}>${c}</th>`).join("")}</tr></thead>
<tbody>${body}</tbody><tfoot><tr><td>รวม</td><td></td><td></td><td>${baht(s.totalPrincipal)}</td><td>${baht(
    s.totalInterest,
  )}</td><td>${baht(s.totalPaid)}</td><td></td></tr></tfoot></table>
<div class="note">ดอกเบี้ยคิดรายเดือนจากเงินต้นคงเหลือ (อัตราต่อปี ÷ 12) ปัดขึ้นเป็น .25 .50 .75 .00</div>
</body></html>`;
}

export default function LoanSchedulePanel() {
  const [inputs, setInputs] = useState<Inputs>(defaults);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setInputs({ ...defaults(), ...JSON.parse(saved) });
    } catch {
      // Private mode or a corrupt entry: start from the defaults.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
    } catch {
      // Not remembering is fine.
    }
  }, [inputs]);

  const set = (patch: Partial<Inputs>) => {
    setNotice(null);
    setInputs((prev) => ({ ...prev, ...patch }));
  };

  const result = useMemo(
    () =>
      buildLoanSchedule({
        principal: parseNumber(inputs.principal),
        annualRatePercent: parseNumber(inputs.rate),
        startDay: inputs.startDay,
        ...(inputs.mode === "months"
          ? { months: parseNumber(inputs.months) }
          : { payment: parseNumber(inputs.payment) }),
      }),
    [inputs],
  );
  const schedule = result.ok ? result.schedule : null;
  const last = schedule?.rows[schedule.rows.length - 1];

  const switchMode = (mode: Mode) => {
    // Carry the current instalment across so the table does not blank out.
    if (mode === "payment" && !inputs.payment && schedule) set({ mode, payment: groupDigits(schedule.payment.toFixed(2)) });
    else set({ mode });
  };

  const reset = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setInputs(defaults());
    setNotice(null);
  };

  const print = () => {
    if (!schedule) return;
    const w = window.open("", "_blank");
    if (!w) {
      setNotice("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — กรุณาอนุญาตป๊อปอัปสำหรับเว็บนี้แล้วกดอีกครั้ง");
      return;
    }
    w.document.write(printDocument(schedule, inputs));
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  const copy = async () => {
    if (!schedule) return;
    const text = [COLUMNS.join("\t")]
      .concat(
        schedule.rows.map((r) =>
          [r.period, formatThaiDay(r.day), r.opening, r.principalPaid, r.interest, r.amount, r.closing]
            .map((v) => (typeof v === "number" ? v.toFixed(2) : v))
            .join("\t"),
        ),
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`คัดลอกแล้ว ${schedule.rows.length} งวด — วางใน Excel ได้เลย`);
    } catch {
      setNotice("คัดลอกไม่สำเร็จ");
    }
  };

  const inputClass = "border border-slate-300 rounded px-3 py-2 text-sm w-full";
  const modeClass = (on: boolean) =>
    `flex-1 text-sm px-3 py-2 rounded border ${
      on ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
    }`;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100">
          <div>
            <h2 className="font-semibold">ตารางผ่อนชำระหนี้ แบบต้นรวมดอก</h2>
            <PanelHelp summary="คำนวณยอดผ่อนรายเดือนและตารางรายงวด ไม่บันทึกลงระบบ">
              <p>
                ชำระงวดเท่ากันทุกเดือน ดอกเบี้ยแต่ละงวดคิดจากเงินต้นคงเหลือ × อัตราต่อปี ÷ 12 แล้วปัดขึ้นเป็น .25
                .50 .75 .00
              </p>
              <p>
                <b>กำหนดจำนวนงวด</b> — ระบบคำนวณยอดชำระต่องวดให้ งวดสุดท้ายปรับเศษให้หนี้หมดพอดี
                <br />
                <b>กำหนดยอดชำระต่องวด</b> — ระบบนับจำนวนงวดให้ และตัดจบในงวดที่หนี้หมด
              </p>
              <p>ค่าที่กรอกจำไว้ในเบราว์เซอร์นี้เท่านั้น กดรีเซ็ตค่าเพื่อกลับเป็นค่าตั้งต้น</p>
            </PanelHelp>
          </div>
          <button
            type="button"
            onClick={reset}
            className="text-sm px-3 py-1.5 rounded bg-orange-500 text-white hover:bg-orange-600 whitespace-nowrap shrink-0"
          >
            ↺ รีเซ็ตค่า
          </button>
        </div>

        <div className="px-4 py-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-slate-600 mb-1">เงินต้น (บาท)</label>
                <input
                  inputMode="decimal"
                  className={inputClass}
                  value={inputs.principal}
                  onChange={(e) => set({ principal: groupDigits(e.target.value) })}
                />
              </div>
              <div>
                <label className="block text-sm text-slate-600 mb-1">ดอกเบี้ย (% ต่อปี)</label>
                <input
                  inputMode="decimal"
                  className={inputClass}
                  value={inputs.rate}
                  onChange={(e) => set({ rate: e.target.value.replace(/[^\d.]/g, "") })}
                />
              </div>
            </div>
            <DateField label="วันที่เริ่มชำระงวดแรก" value={inputs.startDay} onChange={(startDay) => set({ startDay })} />
            <div>
              <label className="block text-sm text-slate-600 mb-1">วิธีคำนวณ</label>
              <div className="flex gap-2">
                <button type="button" className={modeClass(inputs.mode === "months")} onClick={() => switchMode("months")}>
                  กำหนดจำนวนงวด
                </button>
                <button type="button" className={modeClass(inputs.mode === "payment")} onClick={() => switchMode("payment")}>
                  กำหนดยอดชำระต่องวด
                </button>
              </div>
            </div>
            {inputs.mode === "months" ? (
              <div>
                <label className="block text-sm text-slate-600 mb-1">จำนวนงวด (เดือน)</label>
                <input
                  inputMode="numeric"
                  className={inputClass}
                  value={inputs.months}
                  onChange={(e) => set({ months: e.target.value.replace(/\D/g, "") })}
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm text-slate-600 mb-1">ยอดชำระต่องวด (บาท)</label>
                <input
                  inputMode="decimal"
                  className={inputClass}
                  value={inputs.payment}
                  onChange={(e) => set({ payment: groupDigits(e.target.value) })}
                />
              </div>
            )}
            {!result.ok && <p className="text-sm text-red-700 bg-red-50 rounded px-3 py-2">{result.problem}</p>}
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
            <div className="text-sm text-slate-500">ยอดชำระต่องวด</div>
            <div className="text-4xl font-bold text-orange-600 tabular-nums">
              {schedule ? baht(schedule.payment) : "—"} <span className="text-base font-medium text-slate-500">บาท / เดือน</span>
            </div>
            {schedule && last && (
              <>
                {Math.abs(last.amount - schedule.payment) > 0.004 && (
                  <div className="text-sm text-slate-500 mt-1">งวดสุดท้ายชำระ {baht(last.amount)} บาท</div>
                )}
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
                  {[
                    ["จำนวนงวดจริง", `${schedule.rows.length} งวด`],
                    ["ดอกเบี้ยรวม", baht(schedule.totalInterest)],
                    ["ชำระรวมทั้งสิ้น", baht(schedule.totalPaid)],
                    ["งวดสุดท้าย", formatThaiDay(last.day)],
                  ].map(([k, v]) => (
                    <div key={k} className="border-t border-slate-200 pt-2">
                      <dd className="font-semibold tabular-nums whitespace-nowrap">{v}</dd>
                      <dt className="text-xs text-slate-500">{k}</dt>
                    </div>
                  ))}
                </dl>
                <div className="mt-4 h-3 rounded-full overflow-hidden flex bg-slate-200">
                  <div className="bg-sky-500" style={{ width: `${(schedule.totalPrincipal / schedule.totalPaid) * 100}%` }} />
                  <div className="bg-orange-500" style={{ width: `${(schedule.totalInterest / schedule.totalPaid) * 100}%` }} />
                </div>
                <div className="flex gap-4 text-xs text-slate-500 mt-1">
                  <span>
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-sky-500 mr-1" />
                    เงินต้น
                  </span>
                  <span>
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-orange-500 mr-1" />
                    ดอกเบี้ย
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {schedule && (
        <div className="bg-white rounded-lg shadow">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold">ตารางรายงวด</h2>
            <div className="flex flex-wrap items-center gap-2">
              {notice && <span className="text-xs text-slate-500">{notice}</span>}
              <button
                type="button"
                onClick={print}
                className="text-sm px-3 py-1.5 rounded bg-orange-500 text-white hover:bg-orange-600"
              >
                🖨 พิมพ์ตาราง
              </button>
              <button
                type="button"
                onClick={copy}
                className="text-sm px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-50"
              >
                คัดลอกไปวางใน Excel
              </button>
            </div>
          </div>
          <div className="overflow-auto max-h-[70vh]">
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-slate-50 text-slate-500 text-xs sticky top-0">
                <tr>
                  {COLUMNS.map((c, i) => (
                    <th
                      key={c}
                      className={`px-3 py-2 font-semibold whitespace-nowrap ${
                        i === 0 ? "text-center" : i === 1 ? "text-left" : "text-right"
                      }`}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedule.rows.map((r) => (
                  <tr
                    key={r.period}
                    className={`border-t border-slate-100 ${r === last ? "font-semibold text-orange-700" : ""}`}
                  >
                    <td className="px-3 py-1.5 text-center">{r.period}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{formatThaiDay(r.day)}</td>
                    <td className="px-3 py-1.5 text-right">{baht(r.opening)}</td>
                    <td className="px-3 py-1.5 text-right">{baht(r.principalPaid)}</td>
                    <td className="px-3 py-1.5 text-right">{baht(r.interest)}</td>
                    <td className="px-3 py-1.5 text-right">{baht(r.amount)}</td>
                    <td className="px-3 py-1.5 text-right">{baht(r.closing)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 font-semibold sticky bottom-0">
                <tr className="border-t-2 border-slate-200">
                  <td className="px-3 py-2 text-center">รวม</td>
                  <td />
                  <td />
                  <td className="px-3 py-2 text-right">{baht(schedule.totalPrincipal)}</td>
                  <td className="px-3 py-2 text-right">{baht(schedule.totalInterest)}</td>
                  <td className="px-3 py-2 text-right">{baht(schedule.totalPaid)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
