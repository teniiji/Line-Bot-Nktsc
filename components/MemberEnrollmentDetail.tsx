"use client";

import { useEffect, useState } from "react";
import { ACTIONS, ENROLLMENT_PRODUCTS, PAYMENT_METHODS, STATUSES, type EnrollmentProduct } from "@/lib/enrollment";
import type { ShareDebtContract } from "@/lib/shareDebt";
import LoanContracts from "@/components/LoanContracts";
import LoanCollateralCalculator from "@/components/LoanCollateralCalculator";

// รายคน — everything about one member's insurance and cremation memberships:
// what they hold today (the yearly file with what was recorded since), every
// application and cancellation on record, and where each stands in the
// deduction list.

interface Found {
  memberNumber: string;
  memberName: string;
  unitName: string | null;
}

interface EnrollmentRow {
  id: string;
  product: EnrollmentProduct;
  action: keyof typeof ACTIONS;
  status: keyof typeof STATUSES;
  applicationDate: string;
  relativeName: string | null;
  insuredSum: number | null;
  annualPremium: number | null;
  proratedPremium: number | null;
  paymentMethod: keyof typeof PAYMENT_METHODS | null;
  statusDate: string | null;
  statusSource: string | null;
  department: string | null;
  recordedBy: string | null;
  note: string | null;
  deductionPeriod: string | null;
  premiumPaidAt: string | null;
}

interface Holdings {
  age: number | null;
  sharePeriods: number | null;
  shares: number;
  debt: number | null;
  insuredSum: number;
  premium: number;
  premiumDeducted: boolean | null;
  hasSok: boolean;
  hasScs: boolean;
  hasSst: boolean;
  hasSsk: boolean;
  hasSsc?: boolean;
  relativeCount: number;
  relativeFees: number;
  undeducted: string | null;
  debtStatus: string | null;
  notInFile?: boolean;
  changes?: { product: string; action: string; status: string; date: string }[];
}

interface Detail {
  memberNumber: string;
  name: string | null;
  unitName: string | null;
  inRoster: boolean;
  coverage: Holdings | null;
  current: Holdings | null;
  since: string;
  snapshot: { label: string; asOf: string | null } | null;
  shares: {
    label: string;
    asOf: string;
    shares: number | null;
    debt: number | null;
    sharePeriods: number | null;
    contracts: ShareDebtContract[] | null;
    resigned?: boolean;
  } | null;
  enrollments: EnrollmentRow[];
  ssc: { label: string; benefit: number; member: { assocNumber: string | null; lastPeriod: string | null; monthly: number | null } | null } | null;
}

const input = "border border-slate-300 rounded px-2 py-1.5 text-sm bg-white";
const baht = (x: number | null | undefined) => (x == null ? "—" : x.toLocaleString("th-TH", { maximumFractionDigits: 2 }));
const thaiDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("th-TH", { timeZone: "UTC", day: "numeric", month: "short", year: "2-digit" }) : "—";
const STATUS_CLS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-700",
};
const ASSOC: { product: EnrollmentProduct; key: "hasSok" | "hasScs" | "hasSst" | "hasSsk" }[] = [
  { product: "sok", key: "hasSok" },
  { product: "scs", key: "hasScs" },
  { product: "sst", key: "hasSst" },
  { product: "ssk", key: "hasSsk" },
];

export default function MemberEnrollmentDetail({ memberNumber }: { memberNumber: string | null }) {
  const [query, setQuery] = useState(memberNumber ?? "");
  const [found, setFound] = useState<Found[]>([]);
  const [selected, setSelected] = useState<string | null>(memberNumber);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (memberNumber) {
      setSelected(memberNumber);
      setQuery(memberNumber);
    }
  }, [memberNumber]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || q === selected) return setFound([]);
    const t = setTimeout(async () => {
      const res = await fetch(`/api/enrollments/member?q=${encodeURIComponent(q)}`);
      const body = await res.json();
      const list: Found[] = body.data ?? [];
      // An exact number first.
      list.sort((a, b) => Number(b.memberNumber === q.replace(/^0+/, "")) - Number(a.memberNumber === q.replace(/^0+/, "")));
      setFound(list);
    }, 300);
    return () => clearTimeout(t);
  }, [query, selected]);

  useEffect(() => {
    if (!selected) return setDetail(null);
    setLoading(true);
    fetch(`/api/enrollments/member/${encodeURIComponent(selected)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setDetail)
      .finally(() => setLoading(false));
  }, [selected]);

  const open = (n: string) => {
    setSelected(n);
    setQuery(n);
    setFound([]);
  };

  return (
    <div className="space-y-4">
      <section className="bg-white rounded-lg shadow p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && /^\d+$/.test(query.trim())) open(query.trim().replace(/^0+/, ""));
            }}
            placeholder="เลขสมาชิก หรือชื่อ-สกุล"
            className={`${input} w-72`}
            autoFocus
          />
          <span className="text-xs text-slate-500">พิมพ์เลขสมาชิกแล้วกด Enter หรือพิมพ์ชื่อแล้วเลือกจากรายการ</span>
        </div>
        {found.length > 0 && (
          <ul className="border border-slate-200 rounded divide-y divide-slate-100 max-w-xl">
            {found.map((f) => (
              <li key={f.memberNumber}>
                <button type="button" onClick={() => open(f.memberNumber)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50">
                  <span className="num">{f.memberNumber}</span> {f.memberName}
                  <span className="text-xs text-slate-400"> · {f.unitName ?? ""}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {loading && <p className="text-sm text-slate-500">กำลังโหลด…</p>}
      {!loading && selected && !detail && <p className="text-sm text-red-600">ไม่พบข้อมูลเลขสมาชิก {selected}</p>}
      {!loading && detail && <DetailCard d={detail} />}
    </div>
  );
}

function DetailCard({ d }: { d: Detail }) {
  const [loanOpen, setLoanOpen] = useState(false);
  const h = d.current ?? d.coverage;
  const sinceTime = new Date(d.since).getTime();
  // The latest record of each product, to say where a holding came from.
  const lastFor = (product: string) =>
    d.enrollments.find((e) => e.product === product && e.status !== "rejected" && new Date(e.applicationDate).getTime() > sinceTime);
  const source = (product: EnrollmentProduct, inFile: boolean) => {
    const e = lastFor(product);
    if (e) return `${ACTIONS[e.action]} ${thaiDate(e.applicationDate)} (${STATUSES[e.status]})`;
    return inFile ? `ไฟล์ปี ${d.snapshot?.label ?? ""}` : "";
  };
  const newRelatives = d.enrollments.filter(
    (e) => e.product === "relative" && e.status !== "rejected" && new Date(e.applicationDate).getTime() > sinceTime
  );

  return (
    <div className="space-y-4">
      <section className="bg-white rounded-lg shadow p-4">
        <button
          type="button"
          onClick={() => setLoanOpen((v) => !v)}
          className="float-right px-3 py-1.5 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {loanOpen ? "ปิดคำนวณก่อนกู้" : "คำนวณก่อนกู้"}
        </button>
        <h3 className="text-lg font-semibold">
          <span className="num">{d.memberNumber}</span> {d.name ?? "—"}
          {!d.inRoster && <span className="ml-2 text-xs text-amber-700 font-normal">ไม่พบในทะเบียนสมาชิก</span>}
          {d.shares?.resigned && (
            <span className="ml-2 text-xs rounded bg-red-100 text-red-700 px-1.5 py-0.5 font-normal">
              ลาออกแล้ว (ตามรายงาน {d.shares.label})
            </span>
          )}
        </h3>
        <p className="text-sm text-slate-600">
          {d.unitName ?? "—"}
          {h?.age != null && ` · อายุ ${h.age} ปี`}
          {(d.shares?.sharePeriods ?? h?.sharePeriods) != null && ` · เป็นสมาชิก ${d.shares?.sharePeriods ?? h?.sharePeriods} งวด`}
        </p>
        {d.shares ? (
          <p className="text-sm text-slate-600 mt-1">
            หุ้น {baht(d.shares.shares ?? h?.shares)} · หนี้ {baht(d.shares.debt)}{" "}
            <span className="text-xs text-slate-400">(รายงานหุ้นหนี้ {d.shares.label} ณ {thaiDate(d.shares.asOf)})</span>
          </p>
        ) : (
          h && (
            <p className="text-sm text-slate-600 mt-1">
              หุ้น {baht(h.shares)} · หนี้ {baht(h.debt)} <span className="text-xs text-slate-400">(ตามไฟล์ปี)</span>
            </p>
          )
        )}
        {d.shares?.contracts && (
          <div className="mt-3">
            <p className="text-sm font-medium mb-1">หนี้รายสัญญา</p>
            <LoanContracts contracts={d.shares.contracts} total={d.shares.debt} />
          </div>
        )}
        {loanOpen && <LoanCollateralCalculator memberNumber={d.memberNumber} />}
      </section>

      <section className="bg-white rounded-lg shadow p-4 space-y-2">
        <h4 className="font-semibold">มีอยู่ตอนนี้</h4>
        <p className="text-xs text-slate-500">
          ตามไฟล์ปี {d.snapshot?.label ?? "—"} รวมกับการสมัครและยกเลิกที่บันทึกหลังวันที่ของไฟล์ (ไม่นับที่ไม่อนุมัติ)
          {h?.notInFile && " · สมาชิกรายนี้ไม่มีในไฟล์ปี มีเฉพาะที่บันทึกการสมัครไว้"}
        </p>
        {!h ? (
          <p className="text-sm text-slate-400">ไม่มีประกันหรือฌาปนกิจ</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-t border-slate-100">
                <td className="py-1.5 w-40">{ENROLLMENT_PRODUCTS.life}</td>
                <td>
                  {h.insuredSum > 0 ? (
                    <>
                      ✅ ทุน {baht(h.insuredSum)} · เบี้ยปีละ {baht(h.premium)}
                      {h.premiumDeducted != null && (
                        <span className={h.premiumDeducted ? "text-slate-500" : "text-red-600"}>
                          {" "}· หักเบี้ยจากปันผล{h.premiumDeducted ? "ได้" : "ไม่ได้"}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-slate-400">— ไม่มี</span>
                  )}
                </td>
                <td className="text-xs text-slate-500 text-right">{source("life", (d.coverage?.insuredSum ?? 0) > 0)}</td>
              </tr>
              {ASSOC.map(({ product, key }) => (
                <tr key={product} className="border-t border-slate-100">
                  <td className="py-1.5">{ENROLLMENT_PRODUCTS[product]}</td>
                  <td>{h[key] ? "✅ เป็นสมาชิก" : <span className="text-slate-400">— ไม่ได้เป็นสมาชิก</span>}</td>
                  <td className="text-xs text-slate-500 text-right">{source(product, !!d.coverage?.[key])}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-100">
                <td className="py-1.5">สสค.</td>
                <td>{h.hasSsc ? "✅ เป็นสมาชิก" : <span className="text-slate-400">— ไม่ได้เป็นสมาชิก</span>}</td>
                <td className="text-xs text-slate-500 text-right">
                  {d.ssc ? (d.ssc.member ? `รายชื่อ ${d.ssc.label}${d.ssc.member.lastPeriod ? ` · ส่งถึงงวด ${d.ssc.member.lastPeriod}` : ""}` : `ไม่อยู่ในรายชื่อ ${d.ssc.label}`) : "ยังไม่ได้นำเข้ารายชื่อ สสค."}
                </td>
              </tr>
              <tr className="border-t border-slate-100">
                <td className="py-1.5">{ENROLLMENT_PRODUCTS.relative}</td>
                <td>
                  {h.relativeCount > 0 ? `${h.relativeCount} ราย` : <span className="text-slate-400">— ไม่มี</span>}
                  {newRelatives.length > 0 && (
                    <span className="text-xs text-slate-500">
                      {" "}
                      (สมัครใหม่: {newRelatives.map((e) => `${e.relativeName ?? "?"}${e.action === "cancel" ? " ยกเลิก" : ""}`).join(", ")})
                    </span>
                  )}
                </td>
                <td className="text-xs text-slate-500 text-right">
                  {(d.coverage?.relativeCount ?? 0) > 0 ? `ไฟล์ปี ${d.coverage!.relativeCount} ราย · ค่าบำรุงรวม ${baht(d.coverage!.relativeFees)}` : ""}
                </td>
              </tr>
            </tbody>
          </table>
        )}
        {h?.undeducted && <p className="text-sm text-red-600">รายการที่หักไม่ได้ (ตามไฟล์ปี): {h.undeducted}</p>}
      </section>

      <section className="bg-white rounded-lg shadow p-4 space-y-2">
        <h4 className="font-semibold">ประวัติการสมัคร / ยกเลิก ({d.enrollments.length})</h4>
        {d.enrollments.length === 0 ? (
          <p className="text-sm text-slate-400">ยังไม่มีการบันทึกการสมัครหรือยกเลิก</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-500 text-left text-xs">
                <tr>
                  <th className="py-1">วันที่สมัคร</th>
                  <th>รายการ</th>
                  <th>สถานะ</th>
                  <th>ทุน / เบี้ย</th>
                  <th>รายการหัก / เบี้ย</th>
                  <th>ผู้บันทึก</th>
                </tr>
              </thead>
              <tbody>
                {d.enrollments.map((e) => {
                  const beforeFile = new Date(e.applicationDate).getTime() <= sinceTime;
                  return (
                    <tr key={e.id} className="border-t border-slate-100 align-top">
                      <td className="py-1.5 whitespace-nowrap">
                        {thaiDate(e.applicationDate)}
                        {beforeFile && <span className="block text-xs text-slate-400">ก่อนไฟล์ปี</span>}
                      </td>
                      <td>
                        <span className={e.action === "cancel" ? "text-red-700" : ""}>
                          {ACTIONS[e.action]} {ENROLLMENT_PRODUCTS[e.product]}
                        </span>
                        {e.relativeName && <span className="text-slate-600"> ({e.relativeName})</span>}
                        {e.note && <span className="block text-xs text-slate-400">{e.note}</span>}
                      </td>
                      <td>
                        <span className={`px-1.5 py-0.5 rounded text-xs ${STATUS_CLS[e.status]}`}>{STATUSES[e.status]}</span>
                        {e.statusDate && <span className="block text-xs text-slate-400">{thaiDate(e.statusDate)}</span>}
                      </td>
                      <td className="text-xs">
                        {e.product === "life" && e.action === "enroll" ? (
                          <>
                            ทุน {baht(e.insuredSum)} · ปีละ {baht(e.annualPremium)}
                            <span className="block">ตามสัดส่วน {baht(e.proratedPremium)} · {e.paymentMethod ? PAYMENT_METHODS[e.paymentMethod] : "—"}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="text-xs">
                        {e.product === "life"
                          ? e.premiumPaidAt
                            ? `เก็บเบี้ยแล้ว ${thaiDate(e.premiumPaidAt)}`
                            : e.status === "rejected"
                              ? "—"
                              : "ยังไม่ได้เก็บเบี้ย"
                          : e.status === "rejected"
                            ? "—"
                            : e.action === "cancel"
                              ? e.deductionPeriod
                                ? `ตัดออกจากรายการหัก ${e.deductionPeriod}`
                                : "ยังไม่ได้ตัดออกจากรายการหัก"
                              : e.deductionPeriod
                                ? `ใส่ในรายการหัก ${e.deductionPeriod}`
                                : "ยังไม่ได้ใส่ในรายการหัก"}
                      </td>
                      <td className="text-xs text-slate-500">
                        {e.recordedBy ?? "—"}
                        <span className="block">{e.department ?? ""}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
