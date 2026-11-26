"use client";

import { useEffect, useMemo, useState } from "react";
import type { CoverageRates } from "@/lib/coverage";
import type { ShareDebtContract } from "@/lib/shareDebt";
import LoanContracts from "@/components/LoanContracts";
import {
  DEFAULT_LOAN_SETTINGS,
  LOAN_PRODUCTS,
  assessEntitlement,
  assessLoan,
  type LoanEntitlement,
  type LoanSettings,
  type LoanType,
  type MemberHoldings,
} from "@/lib/loanCollateral";

// คำนวณก่อนกู้ — for the credit desk: a member, the loan asked for and what
// it pays off, and whether what the member leaves behind would cover the
// debt after it (lib/loanCollateral.ts); and what the cooperative's rules
// allow for that loan type, with the monthly payment from its published
// repayment tables, set against what the collateral covers.

interface Found {
  memberNumber: string;
  memberName: string;
  unitName: string | null;
}

interface Holdings {
  age: number | null;
  sharePeriods: number | null;
  shares: number;
  debt: number | null;
  insuredSum: number;
  premiumDeducted: boolean | null;
  hasSok: boolean;
  hasScs: boolean;
  hasSst: boolean;
  hasSsk: boolean;
  undeducted: string | null;
  changes?: { product: string; action: string; status: string }[];
}

interface Detail {
  memberNumber: string;
  name: string | null;
  unitName: string | null;
  current: Holdings | null;
  coverage: Holdings | null;
  snapshot: { label: string } | null;
  shares: {
    label: string;
    asOf: string;
    shares: number | null;
    debt: number | null;
    sharePeriods: number | null;
    contracts: ShareDebtContract[] | null;
  } | null;
  rates: CoverageRates;
}

const input = "border border-slate-300 rounded px-2 py-1.5 text-sm bg-white";
const baht = (x: number) => x.toLocaleString("th-TH", { maximumFractionDigits: 2 });
const signed = (x: number) => `${x > 0 ? "+" : ""}${baht(x)}`;
const money = (s: string) => Number(s.replace(/[^\d.]/g, "")) || 0;
const thaiDate = (iso: string) =>
  new Date(iso).toLocaleDateString("th-TH", { timeZone: "UTC", day: "numeric", month: "short", year: "2-digit" });

function holdingsOf(d: Detail): MemberHoldings | null {
  const h = d.current ?? d.coverage;
  if (!h && !d.shares) return null;
  return {
    age: h?.age ?? null,
    sharePeriods: d.shares?.sharePeriods ?? h?.sharePeriods ?? null,
    shares: d.shares?.shares ?? h?.shares ?? 0,
    debt: d.shares?.debt ?? h?.debt ?? 0,
    insuredSum: h?.insuredSum ?? 0,
    premiumDeducted: h?.premiumDeducted ?? null,
    hasSok: !!h?.hasSok,
    hasScs: !!h?.hasScs,
    hasSst: !!h?.hasSst,
    hasSsk: !!h?.hasSsk,
    undeducted: h?.undeducted ?? null,
    pending: (h?.changes ?? []).filter((c) => c.action === "enroll" && c.status === "pending").map((c) => c.product),
  };
}

// memberNumber: open on that member (from ดูรายคน) without the search box.
export default function LoanCollateralCalculator({ memberNumber }: { memberNumber?: string } = {}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [selected, setSelected] = useState<string | null>(memberNumber ?? null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [amount, setAmount] = useState("");
  const [refinance, setRefinance] = useState("");
  const [term, setTerm] = useState("");
  const [loanType, setLoanType] = useState<LoanType>("ordinary");
  const [rate, setRate] = useState("");
  const [salary, setSalary] = useState("");
  const [deductions, setDeductions] = useState("");
  const [settings, setSettings] = useState<LoanSettings>(DEFAULT_LOAN_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState({ maxCoverAge: "", premiumPerMillion: "" });
  const [notice, setNotice] = useState<string | null>(null);
  // Contracts ticked to be paid off by the new loan; their balances fill
  // หักกลบหนี้เดิม (which can still be typed over).
  const [ticked, setTicked] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (memberNumber) setSelected(memberNumber);
  }, [memberNumber]);
  useEffect(() => {
    setTicked(new Set());
    setRefinance("");
  }, [selected]);

  const toggleContract = (i: number) => {
    const next = new Set(ticked);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setTicked(next);
    const contracts = detail?.shares?.contracts ?? [];
    const sum = [...next].reduce((s, k) => s + Math.max(0, contracts[k]?.balance ?? 0), 0);
    setRefinance(sum ? String(Math.round(sum * 100) / 100) : "");
  };

  useEffect(() => {
    fetch("/api/coverage/loan-settings")
      .then((r) => r.json())
      .then((s: LoanSettings) => {
        setSettings(s);
        setDraft({ maxCoverAge: String(s.maxCoverAge), premiumPerMillion: String(s.premiumPerMillion) });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || q === selected) return setFound([]);
    const t = setTimeout(async () => {
      const res = await fetch(`/api/enrollments/member?q=${encodeURIComponent(q)}`);
      setFound((await res.json()).data ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [query, selected]);

  useEffect(() => {
    if (!selected) return setDetail(null);
    fetch(`/api/enrollments/member/${encodeURIComponent(selected)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setDetail);
  }, [selected]);

  const open = (n: string) => {
    setSelected(n);
    setQuery(n);
    setFound([]);
  };

  const product = LOAN_PRODUCTS[loanType];
  // An empty term means the loan type's own (150 for สามัญ…), for the
  // collateral's age check too.
  const termMonths = money(term) || product.terms[0];
  const holdings = detail ? holdingsOf(detail) : null;
  const result = useMemo(
    () =>
      holdings && detail
        ? assessLoan(holdings, { amount: money(amount), refinance: money(refinance), termMonths }, detail.rates, settings)
        : null,
    [holdings, detail, amount, refinance, termMonths, settings]
  );
  const entitlement = useMemo(
    () =>
      assessEntitlement({
        type: loanType,
        amount: money(amount),
        termMonths,
        rate: rate.trim() ? money(rate) : null,
        age: holdings?.age ?? null,
        memberMonths: holdings?.sharePeriods ?? null,
        shares: holdings?.shares ?? 0,
        salary: money(salary) || null,
        otherDeductions: money(deductions) || null,
        collateralMax: result?.maxLoan ?? null,
      }),
    [loanType, amount, termMonths, rate, holdings, salary, deductions, result]
  );

  const saveSettings = async () => {
    const res = await fetch("/api/coverage/loan-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxCoverAge: Number(draft.maxCoverAge), premiumPerMillion: Number(draft.premiumPerMillion) }),
    });
    const body = await res.json();
    if (!res.ok) return setNotice(body.error);
    setSettings(body);
    setNotice("บันทึกค่าแล้ว");
  };

  const summary = () => {
    if (!result || !detail) return "";
    const lines = [
      `คำนวณหลักประกันก่อนกู้ — ${detail.memberNumber} ${detail.name ?? ""} (${detail.unitName ?? ""})`,
      `${entitlement.product.label} วงเงินกู้ ${baht(money(amount))} · หักกลบหนี้เดิม ${baht(money(refinance))} · ${entitlement.term} งวด ดอกเบี้ย ${entitlement.rate}%`,
      `ยอดผ่อน ${baht(entitlement.installment)} บาท/เดือน${entitlement.fromTable ? " (ตามตารางสหกรณ์)" : " (ประมาณ)"}${
        entitlement.row ? ` · ผู้ค้ำ ${entitlement.row.guarantors} คน` : ""
      }${entitlement.sharesNeeded != null ? ` · หุ้นต้องมี ${baht(entitlement.sharesNeeded)}` : ""}`,
      `สิทธิกู้ตามระเบียบ ${baht(entitlement.ruleMax)} · ${entitlement.limits.map((l) => `${l.label} ${baht(l.amount)}`).join(" · ")}`,
      `กู้ได้สูงสุด ${baht(entitlement.overallMax)}${entitlement.binding === "collateral" ? " (จำกัดด้วยหลักประกัน)" : " (จำกัดด้วยระเบียบ)"}`,
      ...entitlement.checks.map((c) => `  ${c.ok ? "✓" : "✗"} ${c.label} — ${c.note}`),
      ...[...ticked].map((k) => {
        const c = detail.shares?.contracts?.[k];
        return c ? `  หักกลบสัญญา ${c.contractNo ?? ""} คงเหลือ ${baht(c.balance)}` : "";
      }),
      ...result.items.map((i) => `  ${i.label}: ${baht(i.amount)}${i.sure ? "" : ` (ไม่นับในยอดมั่นใจได้: ${i.note})`}`),
      `หลักประกันรวม ${baht(result.total)} · มั่นใจได้ ${baht(result.sureTotal)}`,
      `หนี้ปัจจุบัน ${baht(result.debtNow)} → หนี้หลังกู้ ${baht(result.debtAfter)}`,
      `หลักประกันเหลือ (รวม) ${signed(result.margin)} · (มั่นใจได้) ${signed(result.sureMargin)}`,
      result.topUp
        ? result.topUp.possible
          ? `ควรเพิ่มทุนประกัน ${baht(result.topUp.insuredSum)} เบี้ยประมาณ ${baht(result.topUp.premium)} บาท/ปี`
          : `เพิ่มทุนประกันไม่ช่วย: ${result.topUp.reason}`
        : "หลักประกันพอ",
      ...[...entitlement.warnings, ...result.warnings].map((w) => `หมายเหตุ: ${w}`),
      `ข้อมูลหุ้นหนี้: ${detail.shares ? `${detail.shares.label} ณ ${thaiDate(detail.shares.asOf)}` : `ไฟล์ปี ${detail.snapshot?.label ?? ""}`}`,
    ];
    return lines.join("\n");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary());
      setNotice("คัดลอกสรุปแล้ว — วางแนบแฟ้มกู้ได้");
    } catch {
      setNotice("คัดลอกไม่ได้ — ใช้ปุ่มพิมพ์แทน");
    }
  };

  return (
    <div className="mt-4 border-t border-slate-200 pt-4 space-y-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">คำนวณหลักประกันก่อนกู้</p>
          <p className="text-xs text-slate-500">
            หลักประกัน = หุ้น + ทุนประกันชีวิต + ฌาปนกิจของตัวสมาชิก + สวัสดิการสหกรณ์ · หนี้หลังกู้ = หนี้คงเหลือ − หนี้เดิมที่หักกลบ + วงเงินกู้ใหม่
            · &quot;มั่นใจได้&quot; ไม่นับรายการที่หักไม่ได้ รออนุมัติ หรือประกันที่หมดก่อนสัญญาจบ
          </p>
        </div>
        <button type="button" onClick={() => setSettingsOpen((v) => !v)} className="text-xs text-slate-500 hover:text-slate-800">
          ตั้งค่า (อายุคุ้มครอง {settings.maxCoverAge} ปี · เบี้ย {baht(settings.premiumPerMillion)}/ล้าน)
        </button>
      </div>

      {settingsOpen && (
        <div className="flex flex-wrap items-end gap-2 bg-slate-50 rounded p-2">
          <label>
            <span className="block text-xs text-slate-600 mb-1">อายุคุ้มครองสูงสุดของประกันชีวิต (ปี)</span>
            <input value={draft.maxCoverAge} onChange={(e) => setDraft({ ...draft, maxCoverAge: e.target.value })} className={`${input} w-24`} />
          </label>
          <label>
            <span className="block text-xs text-slate-600 mb-1">เบี้ยต่อปี ต่อทุน 1,000,000</span>
            <input value={draft.premiumPerMillion} onChange={(e) => setDraft({ ...draft, premiumPerMillion: e.target.value })} className={`${input} w-28`} />
          </label>
          <button type="button" onClick={saveSettings} className="px-2 py-1.5 text-xs rounded border border-slate-300 bg-white hover:bg-slate-50">
            บันทึก
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className={`relative ${memberNumber ? "hidden" : ""}`}>
          <span className="block text-slate-600 mb-1">สมาชิก</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && /^\d+$/.test(query.trim())) open(query.trim().replace(/^0+/, ""));
            }}
            placeholder="เลขสมาชิก (Enter) หรือชื่อ"
            className={`${input} w-56`}
          />
          {found.length > 0 && (
            <ul className="absolute z-10 mt-1 w-80 bg-white border border-slate-200 rounded shadow divide-y divide-slate-100">
              {found.map((f) => (
                <li key={f.memberNumber}>
                  <button type="button" onClick={() => open(f.memberNumber)} className="w-full text-left px-3 py-1.5 hover:bg-slate-50">
                    <span className="num">{f.memberNumber}</span> {f.memberName}
                    <span className="text-xs text-slate-400"> · {f.unitName ?? ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <label>
          <span className="block text-slate-600 mb-1">ประเภทเงินกู้</span>
          <select
            value={loanType}
            onChange={(e) => {
              setLoanType(e.target.value as LoanType);
              setTerm("");
              setRate("");
            }}
            className={`${input} w-64`}
          >
            {Object.values(LOAN_PRODUCTS).map((p) => (
              <option key={p.type} value={p.type}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-slate-600 mb-1">วงเงินกู้ใหม่</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${input} w-36`} />
        </label>
        <label>
          <span className="block text-slate-600 mb-1">หักกลบหนี้เดิม</span>
          <input inputMode="decimal" value={refinance} onChange={(e) => setRefinance(e.target.value)} placeholder="0" className={`${input} w-36`} />
        </label>
        <label>
          <span className="block text-slate-600 mb-1">จำนวนงวด (เดือน)</span>
          <input
            inputMode="numeric"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={product.terms.join(" / ")}
            list="loan-terms"
            className={`${input} w-28`}
          />
          <datalist id="loan-terms">
            {product.terms.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <label>
          <span className="block text-slate-600 mb-1">ดอกเบี้ย %/ปี</span>
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={String(product.rate)} className={`${input} w-20`} />
        </label>
        <label>
          <span className="block text-slate-600 mb-1">เงินเดือน</span>
          <input inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="ไม่บังคับ" className={`${input} w-28`} />
        </label>
        <label>
          <span className="block text-slate-600 mb-1">รายการหักอื่นต่อเดือน</span>
          <input
            inputMode="decimal"
            value={deductions}
            onChange={(e) => setDeductions(e.target.value)}
            placeholder="หลังหักกลบ"
            title="ยอดหักจากเงินเดือนที่ยังเหลือหลังกู้ใหม่ เช่น ค่าหุ้น เบี้ยประกัน เงินกู้อื่นที่ไม่ได้หักกลบ"
            className={`${input} w-32`}
          />
        </label>
      </div>

      {notice && <p className="text-xs text-emerald-700">{notice}</p>}

      {money(amount) > 0 && <EntitlementView e={entitlement} amount={money(amount)} withCollateral={!!result} />}

      {detail && !holdings && <p className="text-amber-700">ไม่พบข้อมูลหุ้นหนี้หรือประกันของ {detail.memberNumber} — นำเข้าไฟล์ปีหรือรายงานหุ้นหนี้ก่อน</p>}

      {detail && result && (
        <div className="space-y-3">
          <p>
            <strong>
              <span className="num">{detail.memberNumber}</span> {detail.name}
            </strong>{" "}
            <span className="text-slate-500">
              {detail.unitName}
              {holdings?.age != null && ` · อายุ ${holdings.age} ปี`}
              {money(term) > 0 && holdings?.age != null && ` · สัญญาจบอายุประมาณ ${Math.ceil(holdings.age + money(term) / 12)} ปี`}
            </span>
          </p>

          {detail.shares?.contracts && detail.shares.contracts.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-1">ติ๊กสัญญาที่เงินกู้ใหม่จะหักกลบ ระบบใส่ยอดในช่อง &quot;หักกลบหนี้เดิม&quot; ให้</p>
              <LoanContracts contracts={detail.shares.contracts} total={detail.shares.debt} checked={ticked} onToggle={toggleContract} />
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 items-start">
            <table className="w-full">
              <thead className="text-xs text-slate-500 text-left">
                <tr>
                  <th className="py-1">หลักประกัน</th>
                  <th className="text-right">บาท</th>
                  <th className="text-center w-24">มั่นใจได้</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((i) => (
                  <tr key={i.key} className="border-t border-slate-100 align-top">
                    <td className="py-1.5">
                      {i.label}
                      {i.note && <span className={`block text-xs ${i.sure ? "text-slate-400" : "text-amber-700"}`}>{i.note}</span>}
                    </td>
                    <td className="text-right num">{baht(i.amount)}</td>
                    <td className="text-center">{i.sure ? "✓" : <span className="text-amber-700">ไม่นับ</span>}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-300 font-medium">
                  <td className="py-1.5">รวม / มั่นใจได้</td>
                  <td className="text-right num">{baht(result.total)}</td>
                  <td className="text-center num">{baht(result.sureTotal)}</td>
                </tr>
              </tbody>
            </table>

            <div className="space-y-2">
              <table className="w-full">
                <tbody>
                  <tr>
                    <td className="py-1">หนี้คงเหลือปัจจุบัน</td>
                    <td className="text-right num">{baht(result.debtNow)}</td>
                  </tr>
                  <tr>
                    <td className="py-1">หักกลบหนี้เดิม</td>
                    <td className="text-right num">−{baht(Math.min(money(refinance), result.debtNow))}</td>
                  </tr>
                  <tr>
                    <td className="py-1">วงเงินกู้ใหม่</td>
                    <td className="text-right num">+{baht(money(amount))}</td>
                  </tr>
                  <tr className="border-t border-slate-300 font-medium">
                    <td className="py-1">หนี้หลังกู้</td>
                    <td className="text-right num">{baht(result.debtAfter)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["เหลือ (รวม)", result.margin],
                    ["เหลือ (มั่นใจได้)", result.sureMargin],
                  ] as const
                ).map(([label, v]) => (
                  <div key={label} className={`rounded p-2 ${v < 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>
                    <p className="text-xs">{label}</p>
                    <p className="text-lg font-semibold num">{signed(v)}</p>
                    <p className="text-xs">{v < 0 ? "หลักประกันไม่พอ" : "หลักประกันพอ"}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-600">
                กู้ได้สูงสุดโดยหลักประกันมั่นใจได้ยังพอ (ไม่เพิ่มประกัน): <strong className="num">{baht(result.maxLoan)}</strong>
              </p>
              {result.topUp && (
                <p className={`rounded p-2 text-xs ${result.topUp.possible ? "bg-sky-50 text-sky-900" : "bg-amber-50 text-amber-800"}`}>
                  {result.topUp.possible ? (
                    <>
                      แนะนำเพิ่มทุนประกันชีวิต <strong>{baht(result.topUp.insuredSum)}</strong> บาท · เบี้ยประมาณ{" "}
                      <strong>{baht(result.topUp.premium)}</strong> บาท/ปี (คิดตามสัดส่วนเดือนที่เหลือของปีกรมธรรม์ หักจากเงินกู้ได้)
                      หรือสมัครฌาปนกิจเพิ่ม ลดวงเงิน หรือใช้ผู้ค้ำ/หลักทรัพย์เพิ่ม
                    </>
                  ) : (
                    <>เพิ่มทุนประกันไม่ช่วย: {result.topUp.reason} — ลดวงเงิน ลดจำนวนงวด หรือใช้ผู้ค้ำ/หลักทรัพย์เพิ่ม</>
                  )}
                </p>
              )}
              {result.warnings.map((w) => (
                <p key={w} className="text-xs text-amber-700">
                  ⚠️ {w}
                </p>
              ))}
              <p className="text-xs text-slate-400">
                หุ้นหนี้จาก{" "}
                {detail.shares ? `รายงาน ${detail.shares.label} ณ ${thaiDate(detail.shares.asOf)}` : `ไฟล์ปี ${detail.snapshot?.label ?? "—"}`} ·
                ประกันและฌาปนกิจจากไฟล์ปีรวมการสมัครหลังไฟล์ · ใช้ประกอบการพิจารณาความเสี่ยงกรณีเสียชีวิต ไม่แทนเกณฑ์กู้ตามระเบียบ
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={copy} className="px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50">
                  คัดลอกสรุป
                </button>
                <button type="button" onClick={() => window.print()} className="px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50">
                  พิมพ์
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EntitlementView({ e, amount, withCollateral }: { e: LoanEntitlement; amount: number; withCollateral: boolean }) {
  return (
    <div className="rounded border border-slate-200 p-3 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">สิทธิกู้และยอดผ่อน — {e.product.label}</p>
        <p className="text-xs text-slate-500">
          ตารางชำระเงินกู้ของสหกรณ์ (ประกาศปี 2569) · ดอกเบี้ย {e.product.rate}% ต่อปี ทุกประเภท ยกเว้นดอกเบี้ยต่ำ
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3 items-start">
        <div className="rounded bg-slate-50 p-3">
          <p className="text-xs text-slate-500">ยอดผ่อนต่องวด</p>
          <p className="text-2xl font-semibold num">{baht(e.installment)}</p>
          <p className="text-xs text-slate-600">
            {e.term} งวด · {e.rate}% ต่อปี · {e.fromTable ? "ตามตารางสหกรณ์" : "ประมาณ (ต้นและดอกเบี้ยเท่ากันทุกงวด ปัดขึ้นหลักร้อย)"}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            ส่งรวมประมาณ <span className="num">{baht(e.totalPaid)}</span> · ดอกเบี้ยรวมประมาณ <span className="num">{baht(e.totalInterest)}</span>
          </p>
          {e.row && (
            <p className="text-xs text-slate-600 mt-1">
              ช่วงวงเงินไม่เกิน <span className="num">{baht(e.row.upTo)}</span>: ผู้ค้ำ {e.row.guarantors} คน
              {e.sharesNeeded != null && (
                <>
                  {" "}
                  · หุ้นต้องมี <span className="num">{baht(e.sharesNeeded)}</span>
                </>
              )}
              {e.row.minMemberMonths != null && <> · อายุสมาชิก {e.row.minMemberMonths} เดือนขึ้นไป</>}
            </p>
          )}
          {e.remainingSalary != null && (
            <p className="text-xs text-slate-600 mt-1">
              เงินเดือนคงเหลือหลังผ่อน <span className="num">{baht(e.remainingSalary)}</span>
            </p>
          )}
        </div>
        <table className="w-full">
          <thead className="text-xs text-slate-500 text-left">
            <tr>
              <th className="py-1">วงเงินสูงสุดตามระเบียบ</th>
              <th className="text-right">บาท</th>
            </tr>
          </thead>
          <tbody>
            {e.limits.map((l) => (
              <tr key={l.key} className={`border-t border-slate-100 align-top ${l.amount === e.ruleMax ? "font-medium" : ""}`}>
                <td className="py-1.5">
                  {l.label}
                  {l.note && <span className="block text-xs font-normal text-slate-400">{l.note}</span>}
                </td>
                <td className="text-right num">{baht(l.amount)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300 font-medium">
              <td className="py-1.5">สิทธิกู้ตามระเบียบ</td>
              <td className="text-right num">{baht(e.ruleMax)}</td>
            </tr>
          </tbody>
        </table>
        <div className="space-y-2">
          <div className={`rounded p-2 ${amount > e.overallMax ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>
            <p className="text-xs">กู้ได้สูงสุด{withCollateral ? " (ระเบียบ + หลักประกันมั่นใจได้)" : " ตามระเบียบ"}</p>
            <p className="text-lg font-semibold num">{baht(e.overallMax)}</p>
            <p className="text-xs">
              {e.binding === "collateral" ? "จำกัดด้วยหลักประกัน" : e.binding === "rule" ? "จำกัดด้วยระเบียบ" : "เลือกสมาชิกเพื่อเทียบหลักประกัน"}
              {amount > e.overallMax && ` · ขอกู้เกิน ${baht(amount - e.overallMax)}`}
            </p>
          </div>
          {e.checks.map((c) => (
            <p key={c.label} className={`text-xs ${c.ok ? "text-emerald-700" : "text-red-700"}`}>
              {c.ok ? "✓" : "✗"} {c.label} <span className="text-slate-500">— {c.note}</span>
            </p>
          ))}
        </div>
      </div>
      {(e.warnings.length > 0 || e.product.notes.length > 0) && (
        <ul className="text-xs space-y-0.5">
          {e.warnings.map((w) => (
            <li key={w} className="text-amber-700">
              ⚠️ {w}
            </li>
          ))}
          {e.product.notes.map((n) => (
            <li key={n} className="text-slate-500">
              • {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
