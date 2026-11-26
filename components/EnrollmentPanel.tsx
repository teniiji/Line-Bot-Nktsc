"use client";

import { useCallback, useEffect, useState } from "react";
import PanelHelp from "@/components/PanelHelp";
import ConfirmDialog from "@/components/ConfirmDialog";
import EnrollmentDeductionsPanel from "@/components/EnrollmentDeductionsPanel";
import { DEPARTMENTS } from "@/lib/departments";
import {
  ACTIONS,
  ENROLLMENT_PRODUCTS,
  PAYMENT_METHODS,
  PRODUCT_ASSOC,
  STATUSES,
  proratedPremium,
  policyEndFor,
  type EnrollmentProduct,
  type SummaryRow,
} from "@/lib/enrollment";

// สมัครประกัน / ฌาปนกิจ — the day-to-day register of applications between
// one yearly coverage file and the next. See lib/enrollment.ts.

interface Enrollment {
  id: string;
  memberNumber: string;
  memberName: string | null;
  unitName: string | null;
  age: number | null;
  product: EnrollmentProduct;
  action: keyof typeof ACTIONS;
  applicationDate: string;
  insuredSum: number | null;
  annualPremium: number | null;
  proratedPremium: number | null;
  paymentMethod: keyof typeof PAYMENT_METHODS | null;
  relativeName: string | null;
  status: keyof typeof STATUSES;
  statusDate: string | null;
  statusSource: string | null;
  department: string | null;
  recordedBy: string | null;
  note: string | null;
}

interface MemberInfo {
  name: string | null;
  unitName: string | null;
  inRoster: boolean;
  coverage: {
    age: number | null;
    sharePeriods: number | null;
    insuredSum: number;
    hasSok: boolean;
    hasScs: boolean;
    hasSst: boolean;
    hasSsk: boolean;
    relativeCount: number;
    snapshot: { label: string };
  } | null;
  enrollments: { id: string; product: EnrollmentProduct; action: string; status: string; applicationDate: string; relativeName: string | null }[];
}

const baht = (x: number | null | undefined) => (x == null ? "—" : x.toLocaleString("th-TH"));
const thaiDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("th-TH", { timeZone: "UTC", day: "numeric", month: "short", year: "2-digit" }) : "—";
const todayIso = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const thisMonth = () => todayIso().slice(0, 7);
const input = "border border-slate-300 rounded px-2 py-1.5 text-sm bg-white";
const STATUS_CLS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-700",
};

function remembered(key: string): string {
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
    // Storage blocked: the field just starts empty next time.
  }
}

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Two views of the same register: the applications themselves, and what
// they mean for the monthly รายการหัก and premium collection.
export default function EnrollmentPanel() {
  const [view, setView] = useState<"register" | "deductions">("register");
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(
          [
            ["register", "ทะเบียนการสมัคร"],
            ["deductions", "รายการหัก / เก็บเงิน"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={`px-3 py-1.5 text-sm rounded-full border ${
              view === id ? "bg-slate-800 text-white border-slate-800" : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {view === "register" ? <EnrollmentRegister /> : <EnrollmentDeductionsPanel />}
    </div>
  );
}

function EnrollmentRegister() {
  const [month, setMonth] = useState(thisMonth());
  const [product, setProduct] = useState("");
  const [status, setStatus] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Enrollment[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [yearEnd, setYearEnd] = useState<string | null>(null);
  const [yearEndInput, setYearEndInput] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Enrollment | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    const q = new URLSearchParams({ month });
    if (product) q.set("product", product);
    if (status) q.set("status", status);
    if (search) q.set("search", search);
    const res = await fetch(`/api/enrollments?${q}`);
    const body = await res.json();
    setRows(body.data ?? []);
    setSummary(body.summary ?? []);
    setLoading(false);
  }, [month, product, status, search]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/enrollments/settings")
      .then((r) => r.json())
      .then((b) => {
        setYearEnd(b.policyYearEnd ?? null);
        setYearEndInput(b.policyYearEnd ?? "");
      })
      .catch(() => {});
  }, []);

  const saveYearEnd = async () => {
    setError(null);
    const res = await fetch("/api/enrollments/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policyYearEnd: yearEndInput.trim() }),
    });
    const body = await res.json();
    if (!res.ok) return setError(body.error);
    setYearEnd(body.policyYearEnd);
    setNotice(`ตั้งวันสิ้นสุดปีกรมธรรม์เป็น ${body.policyYearEnd} (เดือน-วัน) แล้ว`);
  };

  const setStatusOf = async (r: Enrollment, next: keyof typeof STATUSES) => {
    const res = await fetch(`/api/enrollments/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) setError((await res.json()).error);
    load();
  };

  const remove = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await fetch(`/api/enrollments/${id}`, { method: "DELETE" });
    load();
  };

  const exportCsv = () => {
    const header = [
      "วันที่สมัคร", "เลขสมาชิก", "ชื่อ-สกุล", "หน่วยงาน", "อายุ", "รายการ", "สมัคร/ยกเลิก", "ชื่อญาติ",
      "ทุนประกัน", "เบี้ยทั้งปี", "เบี้ยตามสัดส่วน", "วิธีชำระ", "สถานะ", "วันที่ผล", "ที่มาของผล",
      "แผนก", "ผู้บันทึก", "หมายเหตุ",
    ];
    const lines = rows.map((r) =>
      [
        r.applicationDate.slice(0, 10), r.memberNumber, r.memberName, r.unitName, r.age,
        ENROLLMENT_PRODUCTS[r.product], ACTIONS[r.action], r.relativeName, r.insuredSum, r.annualPremium,
        r.proratedPremium, r.paymentMethod ? PAYMENT_METHODS[r.paymentMethod] : "", STATUSES[r.status],
        r.statusDate?.slice(0, 10), r.statusSource, r.department, r.recordedBy, r.note,
      ].map(csvCell).join(",")
    );
    const blob = new Blob(["﻿" + [header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `สมัครประกันฌาปนกิจ_${month}${product ? `_${ENROLLMENT_PRODUCTS[product as EnrollmentProduct]}` : ""}.csv`;
    a.click();
  };

  const totals = summary.reduce(
    (t, s) => ({ enrolled: t.enrolled + s.enrolled, cancelled: t.cancelled + s.cancelled, pending: t.pending + s.pending, premium: t.premium + s.premium }),
    { enrolled: 0, cancelled: 0, pending: 0, premium: 0 }
  );

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-lg shadow p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">สมัครประกัน / ฌาปนกิจ</h2>
            <PanelHelp summary="บันทึกการสมัครและยกเลิกประกันชีวิตกลุ่มและฌาปนกิจรายวัน ทุกแผนกบันทึกได้ มีผลตั้งแต่วันที่สมัคร">
              <p>
                เบี้ยประกันชีวิตคิดตามสัดส่วนเดือนที่เหลือของปีกรมธรรม์ (นับเดือนที่สมัครเต็มเดือน)
                ชำระโดยหักจากเงินกู้หรือจ่ายเอง — ตรวจคุณสมบัติตามประกาศของสหกรณ์ก่อนบันทึกทุกครั้ง
              </p>
              <p className="mt-1">
                ผลอนุมัติจากบริษัทประกันหรือสมาคม: กด &quot;นำเข้าไฟล์ผลอนุมัติ&quot; เลือกว่าเป็นไฟล์ของอะไร
                ระบบจับคู่ด้วยเลขสมาชิกกับรายการที่รออนุมัติ ถ้าไฟล์มีคอลัมน์ผล/สถานะ ระบบใช้ผลในไฟล์
              </p>
            </PanelHelp>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setFormOpen((v) => !v); setApprovalOpen(false); }} className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700">
              + บันทึกการสมัคร
            </button>
            <button type="button" onClick={() => { setApprovalOpen((v) => !v); setFormOpen(false); }} className="px-3 py-1.5 text-sm rounded border border-slate-300 hover:bg-slate-50">
              นำเข้าไฟล์ผลอนุมัติ
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">ปีกรมธรรม์ประกันชีวิตสิ้นสุดทุกวันที่ (เดือน-วัน)</span>
          <input value={yearEndInput} onChange={(e) => setYearEndInput(e.target.value)} placeholder="03-31" className={`${input} w-24`} />
          <button type="button" onClick={saveYearEnd} className="px-2 py-1 text-xs rounded border border-slate-300 hover:bg-slate-50">
            บันทึก
          </button>
          {!yearEnd && <span className="text-xs text-amber-700">ยังไม่ได้ตั้ง — ระบบยังคิดเบี้ยตามสัดส่วนไม่ได้</span>}
        </div>

        {notice && <p className="text-sm text-emerald-700 bg-emerald-50 rounded px-3 py-2">{notice}</p>}
        {error && <p className="text-sm text-red-700 bg-red-50 rounded px-3 py-2">{error}</p>}

        {formOpen && (
          <EnrollmentForm
            yearEnd={yearEnd}
            onSaved={(msg) => {
              setNotice(msg);
              setError(null);
              load();
            }}
            onError={setError}
          />
        )}
        {approvalOpen && (
          <ApprovalImport
            onDone={(msg) => {
              setNotice(msg);
              setError(null);
              load();
            }}
            onError={setError}
          />
        )}
      </section>

      <section className="bg-white rounded-lg shadow p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={input} />
          <select value={product} onChange={(e) => setProduct(e.target.value)} className={input}>
            <option value="">ทุกรายการ</option>
            {Object.entries(ENROLLMENT_PRODUCTS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={input}>
            <option value="">ทุกสถานะ</option>
            {Object.entries(STATUSES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="ค้นหาเลขสมาชิก / ชื่อ" className={`${input} w-56`} />
          <button type="button" onClick={exportCsv} disabled={rows.length === 0} className="ml-auto px-3 py-1.5 text-sm rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-40">
            ส่งออก CSV ({rows.length})
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-500 border-b">
              <tr>
                <th className="text-left py-1.5">เดือนนี้</th>
                <th className="text-right">สมัคร</th>
                <th className="text-right">ยกเลิก</th>
                <th className="text-right">รออนุมัติ</th>
                <th className="text-right">อนุมัติ</th>
                <th className="text-right">ไม่อนุมัติ</th>
                <th className="text-right">เบี้ยตามสัดส่วน</th>
              </tr>
            </thead>
            <tbody className="num">
              {summary.filter((s) => s.enrolled || s.cancelled).map((s) => (
                <tr key={s.product} className="border-b last:border-0">
                  <td className="py-1.5 font-sans">{ENROLLMENT_PRODUCTS[s.product]}</td>
                  <td className="text-right">{s.enrolled || ""}</td>
                  <td className="text-right">{s.cancelled || ""}</td>
                  <td className="text-right text-amber-700">{s.pending || ""}</td>
                  <td className="text-right text-emerald-700">{s.approved || ""}</td>
                  <td className="text-right text-red-600">{s.rejected || ""}</td>
                  <td className="text-right">{s.premium ? baht(s.premium) : ""}</td>
                </tr>
              ))}
              {totals.enrolled + totals.cancelled === 0 && (
                <tr><td colSpan={7} className="py-3 text-center text-slate-400 font-sans">ยังไม่มีการสมัครในเดือนนี้</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white rounded-lg shadow p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-500 border-b">
              <tr>
                <th className="text-left py-1.5">วันที่สมัคร</th>
                <th className="text-left">สมาชิก</th>
                <th className="text-left">รายการ</th>
                <th className="text-right">ทุน / เบี้ย</th>
                <th className="text-left pl-3">สถานะ</th>
                <th className="text-left">ผู้บันทึก</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="py-6 text-center text-slate-400">กำลังโหลด…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-400">ไม่มีรายการ</td></tr>}
              {!loading && rows.map((r) => (
                <tr key={r.id} className="border-b align-top">
                  <td className="py-2 whitespace-nowrap">{thaiDate(r.applicationDate)}</td>
                  <td>
                    <span className="num">{r.memberNumber}</span> {r.memberName ?? <span className="text-amber-700">ไม่พบในทะเบียน</span>}
                    <span className="block text-xs text-slate-400">{[r.unitName, r.age != null ? `อายุ ${r.age}` : null].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td>
                    <span className={r.action === "cancel" ? "text-red-700" : ""}>{ACTIONS[r.action]}</span> {ENROLLMENT_PRODUCTS[r.product]}
                    {r.relativeName && <span className="block text-xs text-slate-500">ญาติ: {r.relativeName}</span>}
                    {r.note && <span className="block text-xs text-slate-400">{r.note}</span>}
                  </td>
                  <td className="text-right num whitespace-nowrap">
                    {r.insuredSum ? baht(r.insuredSum) : ""}
                    {r.annualPremium != null && (
                      <span className="block text-xs text-slate-500">
                        เบี้ย {baht(r.proratedPremium)} {r.proratedPremium == null ? "(ยังไม่ได้ตั้งปีกรมธรรม์)" : `จาก ${baht(r.annualPremium)}`}
                      </span>
                    )}
                    {r.paymentMethod && <span className="block text-xs text-slate-500 font-sans">{PAYMENT_METHODS[r.paymentMethod]}</span>}
                  </td>
                  <td className="pl-3">
                    <span className={`inline-block text-xs rounded px-1.5 py-0.5 ${STATUS_CLS[r.status]}`}>{STATUSES[r.status]}</span>
                    {r.statusSource && <span className="block text-xs text-slate-400" title={r.statusSource}>{thaiDate(r.statusDate)} · {r.statusSource.slice(0, 24)}</span>}
                  </td>
                  <td className="text-xs text-slate-600">{r.recordedBy}<span className="block text-slate-400">{r.department}</span></td>
                  <td className="text-right whitespace-nowrap text-xs space-x-2">
                    {r.status !== "approved" && <button type="button" onClick={() => setStatusOf(r, "approved")} className="text-emerald-700 hover:underline">อนุมัติ</button>}
                    {r.status !== "rejected" && <button type="button" onClick={() => setStatusOf(r, "rejected")} className="text-red-600 hover:underline">ไม่อนุมัติ</button>}
                    {r.status !== "pending" && <button type="button" onClick={() => setStatusOf(r, "pending")} className="text-slate-500 hover:underline">รออนุมัติ</button>}
                    <button type="button" onClick={() => setPendingDelete(r)} className="text-slate-400 hover:text-red-600">ลบ</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="ลบรายการนี้?"
        description={pendingDelete ? `${pendingDelete.memberNumber} ${pendingDelete.memberName ?? ""} · ${ACTIONS[pendingDelete.action]} ${ENROLLMENT_PRODUCTS[pendingDelete.product]} — ใช้เมื่อบันทึกผิดเท่านั้น` : undefined}
        confirmLabel="ลบ"
        onConfirm={remove}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function EnrollmentForm({
  yearEnd,
  onSaved,
  onError,
}: {
  yearEnd: string | null;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [memberNumber, setMemberNumber] = useState("");
  const [member, setMember] = useState<MemberInfo | null>(null);
  const [action, setAction] = useState<keyof typeof ACTIONS>("enroll");
  const [product, setProduct] = useState<EnrollmentProduct>("sok");
  const [applicationDate, setApplicationDate] = useState(todayIso());
  const [insuredSum, setInsuredSum] = useState("");
  const [annualPremium, setAnnualPremium] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"" | keyof typeof PAYMENT_METHODS>("");
  const [relativeName, setRelativeName] = useState("");
  const [eligibility, setEligibility] = useState(false);
  const [department, setDepartment] = useState("");
  const [recordedBy, setRecordedBy] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDepartment(remembered("enrollment.department"));
    setRecordedBy(remembered("enrollment.recordedBy"));
  }, []);

  useEffect(() => {
    const n = memberNumber.trim();
    if (!n) return setMember(null);
    const t = setTimeout(async () => {
      const res = await fetch(`/api/enrollments/member/${encodeURIComponent(n)}`);
      setMember(res.ok ? await res.json() : null);
    }, 300);
    return () => clearTimeout(t);
  }, [memberNumber]);

  const life = product === "life" && action === "enroll";
  const preview =
    life && Number(annualPremium) > 0 ? proratedPremium(Number(annualPremium), new Date(`${applicationDate}T00:00:00Z`), yearEnd) : null;
  const end = policyEndFor(new Date(`${applicationDate}T00:00:00Z`), yearEnd);

  const assocKey = PRODUCT_ASSOC[product];
  const alreadyIn =
    action === "enroll" && member?.coverage && ((assocKey && member.coverage[assocKey]) || (product === "life" && member.coverage.insuredSum > 0));
  const openApp = member?.enrollments.find((e) => e.product === product && e.status === "pending");

  const save = async () => {
    setSaving(true);
    remember("enrollment.department", department);
    remember("enrollment.recordedBy", recordedBy);
    try {
      const res = await fetch("/api/enrollments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberNumber, product, action, applicationDate, insuredSum, annualPremium,
          paymentMethod: paymentMethod || null, relativeName, eligibilityChecked: eligibility,
          department, recordedBy, note,
        }),
      });
      const body = await res.json();
      if (!res.ok) return onError(body.error ?? "บันทึกไม่สำเร็จ");
      onSaved(`บันทึก${ACTIONS[action]} ${ENROLLMENT_PRODUCTS[product]} ของ ${body.memberNumber} ${body.memberName ?? ""} แล้ว (รออนุมัติ)`);
      setMemberNumber("");
      setInsuredSum("");
      setAnnualPremium("");
      setPaymentMethod("");
      setRelativeName("");
      setEligibility(false);
      setNote("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-slate-200 rounded-lg p-3 space-y-3 text-sm bg-slate-50">
      <div className="flex flex-wrap items-end gap-3">
        <label>
          <span className="block text-slate-600 mb-1">เลขสมาชิก</span>
          <input value={memberNumber} onChange={(e) => setMemberNumber(e.target.value)} autoFocus className={`${input} w-32`} />
        </label>
        <label>
          <span className="block text-slate-600 mb-1">วันที่สมัคร (มีผลวันนี้)</span>
          <input type="date" value={applicationDate} onChange={(e) => setApplicationDate(e.target.value)} className={input} />
        </label>
        <label>
          <span className="block text-slate-600 mb-1">ทำรายการ</span>
          <select value={action} onChange={(e) => setAction(e.target.value as typeof action)} className={input}>
            {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>
          <span className="block text-slate-600 mb-1">รายการ</span>
          <select value={product} onChange={(e) => setProduct(e.target.value as EnrollmentProduct)} className={input}>
            {Object.entries(ENROLLMENT_PRODUCTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>

      {member && (
        <div className="text-xs rounded bg-white border border-slate-200 px-3 py-2 space-y-0.5">
          <p>
            👤 <strong>{member.name ?? "ไม่พบในทะเบียนสมาชิก"}</strong>
            {member.unitName && ` · ${member.unitName}`}
            {member.coverage?.age != null && ` · อายุ ${member.coverage.age} ปี`}
            {member.coverage?.sharePeriods != null && ` · เป็นสมาชิก ${member.coverage.sharePeriods} งวด`}
          </p>
          {member.coverage ? (
            <p className="text-slate-500">
              ในไฟล์ {member.coverage.snapshot.label}: ประกันชีวิต {member.coverage.insuredSum ? `ทุน ${baht(member.coverage.insuredSum)}` : "ไม่มี"} ·
              ฌาปนกิจ{" "}
              {[member.coverage.hasSok && "สสอค", member.coverage.hasScs && "สส.ชสอ", member.coverage.hasSst && "สส.สท", member.coverage.hasSsk && "สส.สก"].filter(Boolean).join(", ") || "ไม่มี"}
              {member.coverage.relativeCount ? ` · ญาติ ${member.coverage.relativeCount} ราย` : ""}
            </p>
          ) : (
            <p className="text-slate-500">ไม่มีในไฟล์ประกันรอบปัจจุบัน</p>
          )}
          {alreadyIn && <p className="text-amber-700">⚠️ มี{ENROLLMENT_PRODUCTS[product]}อยู่แล้วตามไฟล์ — ตรวจก่อนบันทึกซ้ำ</p>}
          {openApp && <p className="text-amber-700">⚠️ มีใบสมัคร{ENROLLMENT_PRODUCTS[product]}ที่รออนุมัติอยู่แล้ว ({thaiDate(openApp.applicationDate)})</p>}
        </div>
      )}

      {life && (
        <div className="flex flex-wrap items-end gap-3">
          <label>
            <span className="block text-slate-600 mb-1">ทุนประกัน</span>
            <input inputMode="numeric" value={insuredSum} onChange={(e) => setInsuredSum(e.target.value.replace(/[^\d]/g, ""))} className={`${input} w-32`} />
          </label>
          <label>
            <span className="block text-slate-600 mb-1">เบี้ยทั้งปี</span>
            <input inputMode="numeric" value={annualPremium} onChange={(e) => setAnnualPremium(e.target.value.replace(/[^\d]/g, ""))} className={`${input} w-28`} />
          </label>
          <div className="text-slate-600">
            เบี้ยตามสัดส่วน:{" "}
            <strong>{preview != null ? `${baht(preview)} บาท` : "—"}</strong>
            {end && <span className="block text-xs text-slate-400">ถึง {thaiDate(end.toISOString())}</span>}
            {!yearEnd && <span className="block text-xs text-amber-700">ตั้งวันสิ้นสุดปีกรมธรรม์ด้านบนก่อน</span>}
          </div>
          <label>
            <span className="block text-slate-600 mb-1">ชำระเบี้ยโดย</span>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)} className={input}>
              <option value="">— เลือก —</option>
              {Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
      )}

      {product === "relative" && (
        <label className="block">
          <span className="block text-slate-600 mb-1">ชื่อญาติที่{ACTIONS[action]}</span>
          <input value={relativeName} onChange={(e) => setRelativeName(e.target.value)} className={`${input} w-72`} />
        </label>
      )}

      <div className="flex flex-wrap items-end gap-3">
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
        <label className="flex-1 min-w-[12rem]">
          <span className="block text-slate-600 mb-1">หมายเหตุ</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={`${input} w-full`} />
        </label>
      </div>

      {action === "enroll" && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={eligibility} onChange={(e) => setEligibility(e.target.checked)} />
          ตรวจคุณสมบัติตามประกาศของสหกรณ์แล้ว (อายุ งวดสมาชิก และเงื่อนไขอื่น)
        </label>
      )}

      <button type="button" onClick={save} disabled={saving} className="px-4 py-1.5 rounded bg-slate-900 text-white disabled:opacity-40">
        {saving ? "กำลังบันทึก…" : "บันทึก"}
      </button>
    </div>
  );
}

function ApprovalImport({ onDone, onError }: { onDone: (msg: string) => void; onError: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/enrollments/approvals", { method: "POST", body: new FormData(e.currentTarget) });
      const body = await res.json();
      if (!res.ok) return onError(body.error ?? "นำเข้าไม่สำเร็จ");
      onDone(
        `ไฟล์มี ${body.listed} ราย · อนุมัติ ${body.approved} · ไม่อนุมัติ ${body.rejected}` +
          (body.notPendingCount ? ` · ไม่พบใบสมัครที่รออนุมัติ ${body.notPendingCount} ราย: ${body.notPending.join(", ")}` : "")
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="border border-slate-200 rounded-lg p-3 flex flex-wrap items-end gap-3 text-sm bg-slate-50">
      <label>
        <span className="block text-slate-600 mb-1">ไฟล์ผลของ</span>
        <select name="product" required className={input} defaultValue="">
          <option value="" disabled>— เลือก —</option>
          {Object.entries(ENROLLMENT_PRODUCTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label>
        <span className="block text-slate-600 mb-1">ถ้าไฟล์ไม่มีคอลัมน์ผล ให้ถือว่า</span>
        <select name="result" className={input} defaultValue="approved">
          <option value="approved">อนุมัติทุกคนในไฟล์</option>
          <option value="rejected">ไม่อนุมัติทุกคนในไฟล์</option>
        </select>
      </label>
      <label>
        <span className="block text-slate-600 mb-1">ไฟล์ Excel (มีคอลัมน์เลขสมาชิก)</span>
        <input type="file" name="file" accept=".xlsx,.xls,.csv" required className="text-sm" />
      </label>
      <button type="submit" disabled={busy} className="px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50">
        {busy ? "กำลังนำเข้า…" : "นำเข้า"}
      </button>
    </form>
  );
}
