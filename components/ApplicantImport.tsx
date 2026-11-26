"use client";

import { useEffect, useState } from "react";
import { DEPARTMENTS } from "@/lib/departments";
import { ENROLLMENT_PRODUCTS, PAYMENT_METHODS, type EnrollmentProduct } from "@/lib/enrollment";
import type { PlannedRow } from "@/lib/enrollmentImport";

// นำเข้ารายชื่อผู้สมัคร — a round's list of applicants from an association
// or the insurer, recorded in one go (lib/enrollmentImport.ts). Staff see the
// plan first: who will be recorded, and who will not and why.

const input = "border border-slate-300 rounded px-2 py-1.5 text-sm bg-white";
const todayIso = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const thaiDate = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("th-TH", { timeZone: "UTC", day: "numeric", month: "short", year: "2-digit" }) : "—";

function remembered(key: string) {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function remember(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

const PRODUCTS = (Object.keys(ENROLLMENT_PRODUCTS) as EnrollmentProduct[]).filter((p) => p !== "relative");

interface Plan {
  rows: PlannedRow[];
  create: number;
  skip: number;
  missingDate: boolean;
}

export default function ApplicantImport({ onDone, onError }: { onDone: (msg: string) => void; onError: (msg: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [product, setProduct] = useState<EnrollmentProduct | "">("");
  const [defaultDate, setDefaultDate] = useState(todayIso());
  const [status, setStatus] = useState<"approved" | "pending">("approved");
  const [paymentMethod, setPaymentMethod] = useState<"" | keyof typeof PAYMENT_METHODS>("");
  const [department, setDepartment] = useState("");
  const [recordedBy, setRecordedBy] = useState("");
  const [eligibility, setEligibility] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const [busy, setBusy] = useState(false);
  // Changed to empty the file picker after recording.
  const [pickerKey, setPickerKey] = useState(0);

  useEffect(() => {
    setDepartment(remembered("enrollment.department"));
    setRecordedBy(remembered("enrollment.recordedBy"));
  }, []);

  // A new file, list type or date makes the shown plan stale.
  useEffect(() => setPlan(null), [file, product, defaultDate]);

  const send = async (mode: "preview" | "commit") => {
    if (!file || !product) return onError("เลือกรายชื่อสมัครอะไร และเลือกไฟล์ก่อน");
    const data = new FormData();
    data.set("file", file);
    data.set("product", product);
    data.set("mode", mode);
    data.set("defaultDate", defaultDate);
    data.set("status", status);
    data.set("paymentMethod", paymentMethod);
    data.set("department", department);
    data.set("recordedBy", recordedBy);
    data.set("eligibilityChecked", eligibility ? "true" : "false");
    setBusy(true);
    try {
      const res = await fetch("/api/enrollments/import", { method: "POST", body: data });
      const body = await res.json();
      if (!res.ok) return onError(body.error ?? "นำเข้าไม่สำเร็จ");
      if (mode === "preview") {
        setPlan(body);
        setShowSkipped(body.create === 0);
        return;
      }
      remember("enrollment.department", department);
      remember("enrollment.recordedBy", recordedBy);
      onDone(`บันทึกผู้สมัคร ${ENROLLMENT_PRODUCTS[product]} ${body.created} ราย${body.skipped ? ` · ข้าม ${body.skipped} ราย` : ""}`);
      setPlan(null);
      setFile(null);
      setPickerKey((k) => k + 1);
      setEligibility(false);
    } finally {
      setBusy(false);
    }
  };

  const shown = plan ? plan.rows.filter((r) => showSkipped || r.action === "create") : [];
  const reasons = plan
    ? Object.entries(
        plan.rows.filter((r) => r.action === "skip").reduce<Record<string, number>>((m, r) => {
          m[r.reason ?? ""] = (m[r.reason ?? ""] ?? 0) + 1;
          return m;
        }, {})
      )
    : [];

  return (
    <div className="border border-slate-200 rounded-lg p-3 space-y-3 text-sm bg-slate-50">
      <p className="text-xs text-slate-500">
        รายชื่อผู้สมัครรอบใหม่จากสมาคมหรือบริษัทประกัน (Excel ที่มีคอลัมน์ &quot;เลขสมาชิก สอ.&quot; ชื่อ และรอบ เช่น 11/69)
        รายการที่เลขสมาชิกมีตัวอักษรนำหน้า เช่น ม29477 บันทึกเป็นฌาปนกิจญาติของสมาชิกเลขนั้น — ระบบแสดงรายการให้ตรวจก่อนบันทึก
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label>
          <span className="block text-slate-600 mb-1">รายชื่อสมัคร</span>
          <select value={product} onChange={(e) => setProduct(e.target.value as EnrollmentProduct)} className={input}>
            <option value="">— เลือก —</option>
            {PRODUCTS.map((p) => <option key={p} value={p}>{ENROLLMENT_PRODUCTS[p]}</option>)}
          </select>
        </label>
        <label>
          <span className="block text-slate-600 mb-1">ไฟล์ Excel</span>
          <input key={pickerKey} type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        </label>
        <label>
          <span className="block text-slate-600 mb-1">วันที่สมัคร (ถ้าแถวไม่มีรอบ)</span>
          <input type="date" value={defaultDate} onChange={(e) => setDefaultDate(e.target.value)} className={input} />
        </label>
        <button type="button" onClick={() => send("preview")} disabled={busy || !file || !product} className="px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-40">
          {busy && !plan ? "กำลังตรวจ…" : "ตรวจรายชื่อ"}
        </button>
      </div>

      {plan && (
        <div className="space-y-3">
          <p>
            ในไฟล์ {plan.rows.length.toLocaleString("th-TH")} ราย · <strong className="text-emerald-700">จะบันทึก {plan.create.toLocaleString("th-TH")} ราย</strong>
            {plan.skip > 0 && (
              <>
                {" "}· <span className="text-amber-700">ข้าม {plan.skip} ราย</span> ({reasons.map(([r, n]) => `${r} ${n}`).join(" · ")})
              </>
            )}
          </p>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={showSkipped} onChange={(e) => setShowSkipped(e.target.checked)} />
            แสดงรายการที่ข้ามด้วย
          </label>
          <div className="max-h-80 overflow-y-auto border border-slate-200 rounded bg-white">
            <table className="w-full text-xs">
              <thead className="text-slate-500 sticky top-0 bg-white">
                <tr className="text-left">
                  <th className="px-2 py-1">แถว</th>
                  <th>เลขสมาชิก</th>
                  <th>ชื่อในไฟล์</th>
                  <th>ชื่อในทะเบียน</th>
                  <th>บันทึกเป็น</th>
                  <th>วันที่สมัคร</th>
                  <th className="text-right pr-2">เรียกเก็บ</th>
                  <th>ผล</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.rowNumber} className={`border-t border-slate-100 ${r.action === "skip" ? "text-slate-400" : ""}`}>
                    <td className="px-2 py-1 num">{r.rowNumber}</td>
                    <td className="num">{r.relativeMark ? `${r.relativeMark}${r.memberNumber}` : r.memberNumber}</td>
                    <td>{r.name ?? "—"}</td>
                    <td>{r.rosterName ?? "—"}</td>
                    <td>
                      {ENROLLMENT_PRODUCTS[r.product]}
                      {r.product === "life" && r.insuredSum ? ` ทุน ${r.insuredSum.toLocaleString("th-TH")}` : ""}
                    </td>
                    <td>{thaiDate(r.applicationDate)}{r.round ? ` (รอบ ${r.round})` : ""}</td>
                    <td className="text-right pr-2 num">{r.amount?.toLocaleString("th-TH") ?? ""}</td>
                    <td className={r.action === "create" ? "text-emerald-700" : r.reason?.startsWith("ชื่อไม่ตรง") || r.reason?.startsWith("เลขสมาชิก") ? "text-red-600" : "text-amber-700"}>
                      {r.action === "create" ? "บันทึก" : r.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {plan.create > 0 && (
            <div className="space-y-3 border-t border-slate-200 pt-3">
              <div className="flex flex-wrap items-end gap-3">
                <label>
                  <span className="block text-slate-600 mb-1">สถานะ</span>
                  <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={input}>
                    <option value="approved">อนุมัติแล้ว (รายชื่อที่สมาคม/บริษัทรับแล้ว)</option>
                    <option value="pending">รออนุมัติ</option>
                  </select>
                </label>
                {product === "life" && (
                  <label>
                    <span className="block text-slate-600 mb-1">ชำระเบี้ยโดย</span>
                    <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)} className={input}>
                      <option value="">— เลือก —</option>
                      {Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </label>
                )}
                <label>
                  <span className="block text-slate-600 mb-1">แผนกที่รับเรื่อง</span>
                  <select value={department} onChange={(e) => setDepartment(e.target.value)} className={input}>
                    <option value="">— เลือก —</option>
                    {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </label>
                <label>
                  <span className="block text-slate-600 mb-1">ผู้บันทึก</span>
                  <input value={recordedBy} onChange={(e) => setRecordedBy(e.target.value)} className={`${input} w-40`} />
                </label>
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={eligibility} onChange={(e) => setEligibility(e.target.checked)} />
                ตรวจคุณสมบัติของผู้สมัครทั้ง {plan.create} รายตามประกาศของสหกรณ์แล้ว
              </label>
              <button
                type="button"
                onClick={() => send("commit")}
                disabled={busy || !eligibility || !department || !recordedBy.trim() || (product === "life" && !paymentMethod)}
                className="px-4 py-1.5 rounded bg-slate-900 text-white disabled:opacity-40"
              >
                {busy ? "กำลังบันทึก…" : `บันทึก ${plan.create} ราย`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
