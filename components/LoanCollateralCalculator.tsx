"use client";

import { useEffect, useMemo, useState } from "react";
import type { CoverageRates } from "@/lib/coverage";
import type { ShareDebtContract } from "@/lib/shareDebt";
import LoanContracts from "@/components/LoanContracts";
import { LOAN_PRODUCTS, assessEligibility, type LoanProduct } from "@/lib/loanRules";
import {
  DEFAULT_LOAN_SETTINGS,
  assessLoan,
  type LoanSettings,
  type MemberHoldings,
} from "@/lib/loanCollateral";

// คำนวณก่อนกู้ — for the credit desk: a member, the loan asked for and what
// it pays off, and whether what the member leaves behind would cover the
// debt after it (lib/loanCollateral.ts).

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
  hasSsc?: boolean;
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
    resigned?: boolean;
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
    hasSsc: !!h?.hasSsc,
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
  const [term, setTerm] = useState("150");
  // สิทธิกู้ (lib/loanRules.ts): the product, and the salary figures the
  // report does not carry.
  const [product, setProduct] = useState<LoanProduct>("ordinary");
  const [salary, setSalary] = useState("");
  const [otherDeductions, setOtherDeductions] = useState("");
  const [neverBorrowed, setNeverBorrowed] = useState(false);
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

  // One member at a time: the previous member's figures go as soon as
  // another is chosen, and a slow answer for an earlier choice is dropped
  // rather than shown under the new one.
  useEffect(() => {
    setDetail(null);
    if (!selected) return;
    let current = true;
    fetch(`/api/enrollments/member/${encodeURIComponent(selected)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (current) setDetail(d);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [selected]);

  const open = (n: string) => {
    setSelected(n);
    setQuery(n);
    setFound([]);
  };

  const holdings = detail ? holdingsOf(detail) : null;
  const contracts = detail?.shares?.contracts ?? [];
  const currentRepayments = contracts.reduce((s, c) => s + (c.payment ?? 0), 0);
  const refinancedRepayments = [...ticked].reduce((s, k) => s + (contracts[k]?.payment ?? 0), 0);
  // The rule: a loan is renewed only after three instalments have been paid.
  const tooRecent = [...ticked].map((k) => contracts[k]).filter((c) => c && c.installment != null && c.installment < 3);
  const eligibility = useMemo(
    () =>
      holdings
        ? assessEligibility({
            product,
            amount: money(amount),
            term: money(term),
            age: holdings.age,
            months: holdings.sharePeriods,
            shares: holdings.shares,
            salary: money(salary) || null,
            otherDeductions: money(otherDeductions),
            currentRepayments,
            refinancedRepayments,
            neverBorrowed,
          })
        : null,
    [holdings, product, amount, term, salary, otherDeductions, currentRepayments, refinancedRepayments, neverBorrowed]
  );
  const result = useMemo(
    () =>
      holdings && detail
        ? assessLoan(holdings, { amount: money(amount), refinance: money(refinance), termMonths: money(term) || null }, detail.rates, settings)
        : null,
    [holdings, detail, amount, refinance, term, settings]
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
      `คำนวณก่อนกู้ — ${detail.memberNumber} ${detail.name ?? ""} (${detail.unitName ?? ""})`,
      `${LOAN_PRODUCTS[product].label} วงเงิน ${baht(money(amount))} · ${term} งวด · หักกลบหนี้เดิม ${baht(money(refinance))}`,
      ...(eligibility
        ? [
            `ผ่อนงวดละ ${baht(eligibility.payment)}${eligibility.fromTable ? " (ตามตารางสหกรณ์)" : " (ประมาณ)"} · ผู้ค้ำ ${eligibility.guarantors} คน${eligibility.sharesNeeded != null ? ` · หุ้นตามตาราง ${baht(eligibility.sharesNeeded)}` : ""}`,
            ...eligibility.checks.map((c) => `  ${c.state === "ok" ? "✓" : c.state === "fail" ? "✗" : "?"} ${c.label}: ${c.detail}`),
            `วงเงินสูงสุดตามสิทธิ ${eligibility.maxAmount != null ? baht(eligibility.maxAmount) : "—"}`,
          ]
        : []),
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
      ...result.warnings.map((w) => `หมายเหตุ: ${w}`),
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
            onChange={(e) => {
              setQuery(e.target.value);
              // Typing another member takes the last one off the screen, so
              // its figures are never read as the new one's.
              if (selected && e.target.value.trim().replace(/^0+/, "") !== selected) setSelected(null);
            }}
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
            value={product}
            onChange={(e) => {
              const next = e.target.value as LoanProduct;
              setProduct(next);
              setTerm(String(LOAN_PRODUCTS[next].terms[0]));
            }}
            className={input}
          >
            {(Object.keys(LOAN_PRODUCTS) as LoanProduct[]).map((k) => (
              <option key={k} value={k}>
                {LOAN_PRODUCTS[k].label}
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
          <span className="block text-slate-600 mb-1">จำนวนงวด</span>
          <select value={term} onChange={(e) => setTerm(e.target.value)} className={input}>
            {LOAN_PRODUCTS[product].terms.map((t) => (
              <option key={t} value={t}>
                {t} งวด ({LOAN_PRODUCTS[product].rate}%)
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label>
          <span className="block text-slate-600 mb-1">เงินเดือน</span>
          <input inputMode="decimal" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="ตามสลิป" className={`${input} w-32`} />
        </label>
        <label title="หุ้นรายเดือน ภาษี กบข. เบี้ยประกัน ฌาปนกิจ และหนี้ที่อื่น — ไม่รวมเงินกู้สหกรณ์ (ระบบใช้ยอดชำระรายสัญญาให้)">
          <span className="block text-slate-600 mb-1">ยอดหักอื่นต่อเดือน (ไม่รวมเงินกู้สหกรณ์)</span>
          <input inputMode="decimal" value={otherDeductions} onChange={(e) => setOtherDeductions(e.target.value)} placeholder="0" className={`${input} w-40`} />
        </label>
        <label className="flex items-center gap-1.5 pb-2">
          <input type="checkbox" checked={neverBorrowed} onChange={(e) => setNeverBorrowed(e.target.checked)} />
          ไม่เคยกู้มาก่อน
        </label>
      </div>

      {notice && <p className="text-xs text-emerald-700">{notice}</p>}

      {detail && !holdings && <p className="text-amber-700">ไม่พบข้อมูลหุ้นหนี้หรือประกันของ {detail.memberNumber} — นำเข้าไฟล์ปีหรือรายงานหุ้นหนี้ก่อน</p>}

      {detail?.shares?.resigned && (
        <p className="rounded bg-red-50 text-red-700 p-2">
          สมาชิก {detail.memberNumber} ลาออกแล้วตามรายงาน {detail.shares.label} — ไม่อยู่ในรายชื่อแท็บประกันและหลักประกัน
        </p>
      )}

      {detail && result && (
        <div className="space-y-3">
          <p>
            <strong>
              <span className="num">{detail.memberNumber}</span> {detail.name}
            </strong>{" "}
            <span className="text-slate-500">
              {detail.unitName}
              {holdings?.age != null && ` · อายุ ${holdings.age} ปี`}
              {holdings?.sharePeriods != null && ` · สมาชิก ${holdings.sharePeriods} งวด`}
              {money(term) > 0 && holdings?.age != null && ` · สัญญาจบอายุประมาณ ${Math.ceil(holdings.age + money(term) / 12)} ปี`}
            </span>
          </p>

          {detail.shares?.contracts && detail.shares.contracts.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-1">ติ๊กสัญญาที่เงินกู้ใหม่จะหักกลบ ระบบใส่ยอดในช่อง &quot;หักกลบหนี้เดิม&quot; ให้</p>
              <LoanContracts contracts={detail.shares.contracts} total={detail.shares.debt} checked={ticked} onToggle={toggleContract} />
            </div>
          )}

          {eligibility && (
            <div className="rounded border border-slate-200 p-3 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">สิทธิกู้และยอดผ่อน · {LOAN_PRODUCTS[product].label}</p>
                <p className="text-xs text-slate-500">ตามตารางชำระเงินกู้และเงื่อนไขบนเว็บสหกรณ์ (ปี 2569) — คณะกรรมการเงินกู้เป็นผู้อนุมัติ</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                <div className="rounded bg-slate-50 p-2">
                  <p className="text-xs text-slate-500">ผ่อนต่องวด</p>
                  <p className="text-lg font-semibold num">{baht(eligibility.payment)}</p>
                  <p className="text-xs text-slate-500">{eligibility.fromTable ? "ตามตารางสหกรณ์" : "ประมาณ (ผ่อนเท่ากันทุกงวด)"}</p>
                </div>
                <div className="rounded bg-slate-50 p-2">
                  <p className="text-xs text-slate-500">ผู้ค้ำประกัน</p>
                  <p className="text-lg font-semibold num">{eligibility.guarantors} คน</p>
                  {eligibility.sharesNeeded != null && <p className="text-xs text-slate-500">หุ้นตามตาราง {baht(eligibility.sharesNeeded)}</p>}
                </div>
                <div className="rounded bg-slate-50 p-2">
                  <p className="text-xs text-slate-500">เงินเดือนคงเหลือหลังหัก</p>
                  <p className={`text-lg font-semibold num ${eligibility.remaining != null && eligibility.remaining < 0 ? "text-red-600" : ""}`}>
                    {eligibility.remaining != null ? baht(eligibility.remaining) : "—"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {eligibility.remainingPct != null ? `${eligibility.remainingPct}%` : "ใส่เงินเดือน"}
                    {eligibility.requiredPct != null && ` · เกณฑ์ ≥ ${eligibility.requiredPct}%`}
                  </p>
                </div>
                <div className="rounded bg-emerald-50 p-2">
                  <p className="text-xs text-emerald-800">วงเงินสูงสุดตามสิทธิ</p>
                  <p className="text-lg font-semibold num text-emerald-900">{eligibility.maxAmount != null ? baht(eligibility.maxAmount) : "ไม่มีสิทธิ"}</p>
                  {eligibility.maxAmount != null && eligibility.maxAmount !== money(amount) && (
                    <button type="button" onClick={() => setAmount(String(eligibility.maxAmount))} className="text-xs text-emerald-800 underline">
                      ใช้วงเงินนี้
                    </button>
                  )}
                </div>
              </div>
              <ul className="text-sm space-y-0.5">
                {eligibility.checks.map((c) => (
                  <li key={c.label} className={c.state === "fail" ? "text-red-700" : c.state === "unknown" ? "text-amber-700" : "text-slate-700"}>
                    {c.state === "ok" ? "✓" : c.state === "fail" ? "✗" : "?"} {c.label}: <span className="text-slate-500">{c.detail}</span>
                  </li>
                ))}
                {tooRecent.map((c) => (
                  <li key={c!.contractNo} className="text-red-700">
                    ✗ สัญญา {c!.contractNo} ชำระมาแล้ว {c!.installment} งวด — ต้องชำระอย่างน้อย 3 งวดก่อนกู้ใหม่
                  </li>
                ))}
              </ul>
              {eligibility.capReasons.length > 0 && (
                <p className="text-xs text-slate-500">เพดานตามระเบียบ {baht(eligibility.capByRules ?? 0)}: {eligibility.capReasons.join(" · ")}</p>
              )}
              {currentRepayments > 0 && (
                <p className="text-xs text-slate-500">
                  ผ่อนเงินกู้สหกรณ์อยู่ {baht(currentRepayments)}/เดือน{refinancedRepayments ? ` · หักกลบแล้วเหลือ ${baht(currentRepayments - refinancedRepayments)}` : ""}
                </p>
              )}
              {eligibility.notes.map((n) => (
                <p key={n} className="text-xs text-slate-500">
                  • {n}
                </p>
              ))}
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
