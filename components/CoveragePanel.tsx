"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import PanelHelp from "@/components/PanelHelp";
import MultiSelect from "@/components/MultiSelect";
import ConfirmDialog from "@/components/ConfirmDialog";
import ShareDebtReports from "@/components/ShareDebtReports";
import LoanCollateralCalculator from "@/components/LoanCollateralCalculator";
import CoverageReconcile from "@/components/CoverageReconcile";
import { ACTIONS, ENROLLMENT_PRODUCTS, STATUSES, type EnrollmentProduct } from "@/lib/enrollment";
import {
  AGE_BANDS,
  parseUndeducted,
  type CoverageRow,
  type CoverageSummary,
  type CoverageTotals,
} from "@/lib/coverage";

// ประกันและหลักประกัน — for each member who holds the group life policy:
// what they owe, and what stands behind it (หุ้น + ทุนประกัน + ฌาปนกิจ of
// their own + สวัสดิการสหกรณ์). The list opens on the worst shortfall first,
// because the question it answers is "who should we be looking at".

interface Snapshot {
  id: string;
  label: string;
  asOf: string | null;
  ageAsOf: string | null;
  benefitSok: number;
  benefitScs: number;
  benefitSst: number;
  benefitSsk: number;
  welfarePerPeriod: number;
  welfareCap: number;
  createdAt: string;
}

interface ShareReportInfo {
  id: string;
  label: string;
  asOf: string;
  memberCount: number;
}

interface SnapshotListItem {
  id: string;
  label: string;
  isCurrent: boolean;
  createdAt: string;
  _count: { members: number };
}

interface ImportResult {
  imported?: number;
  label?: string;
  problemCount?: number;
  problems?: { rowNumber: number; reason: string }[];
  unknownMemberCount?: number;
  unknownMembers?: string[];
  error?: string;
}

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

const baht = (x: number) => x.toLocaleString("th-TH", { maximumFractionDigits: 0 });
const million = (x: number) =>
  `${(x / 1_000_000).toLocaleString("th-TH", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ล้าน`;
const thaiDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("th-TH", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }) : "—";
const signed = (x: number) => `${x > 0 ? "+" : ""}${baht(x)}`;

const ASSOC = [
  { key: "hasSok", label: "สสอค", cls: "bg-sky-100 text-sky-800" },
  { key: "hasScs", label: "ชสอ", cls: "bg-emerald-100 text-emerald-800" },
  { key: "hasSst", label: "สท", cls: "bg-amber-100 text-amber-800" },
  { key: "hasSsk", label: "สก", cls: "bg-violet-100 text-violet-800" },
] as const;

function Card({ title, value, sub, tone }: { title: string; value: string; sub?: string; tone?: "bad" }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <p className="text-sm text-slate-500">{title}</p>
      <p className={`text-2xl font-semibold num ${tone === "bad" ? "text-red-600" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1 num">{sub}</p>}
    </div>
  );
}

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(rows: CoverageRow[], label: string) {
  const head = [
    "เลขสมาชิก", "ชื่อ-สกุล", "หน่วยงาน", "อายุ", "งวดหุ้น", "หุ้น", "หนี้รวม", "ทุนประกัน",
    "ฌาปนกิจ (เจ้าตัว)", "สวัสดิการสหกรณ์", "หลักประกันรวม", "หลักประกันเหลือ",
    "สสอค", "สส.ชสอ", "สส.สท", "สส.สก", "ประกัน (หักจากปันผล)", "รายการที่หักไม่ได้",
  ];
  const lines = rows.map((r) =>
    [
      r.memberNumber, r.memberName, r.unitName, r.age, r.sharePeriods, r.shares, r.debt, r.insuredSum,
      r.cremation, r.welfare, r.total, r.margin,
      r.hasSok ? "✓" : "", r.hasScs ? "✓" : "", r.hasSst ? "✓" : "", r.hasSsk ? "✓" : "",
      r.premiumDeducted == null ? "" : r.premiumDeducted ? "หักได้" : "หักไม่ได้", r.undeducted,
    ].map(csvCell).join(",")
  );
  const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ประกันและหลักประกัน_${label}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Breakdown({ r, s }: { r: CoverageRow; s: Snapshot }) {
  const line = (label: string, value: number, note?: string) => (
    <div className="flex justify-between gap-4">
      <span>
        {label}
        {note && <span className="text-slate-400"> {note}</span>}
      </span>
      <span className="num">{baht(value)}</span>
    </div>
  );
  return (
    <div className="grid gap-6 md:grid-cols-2 text-sm">
      <div className="space-y-1">
        {line("หุ้น", r.shares, r.fileShares != null && r.fileShares !== r.shares ? `(ไฟล์ปี ${baht(r.fileShares)})` : undefined)}
        {line("ทุนประกันชีวิต", r.insuredSum, r.premium ? `(เบี้ย ${baht(r.premium)})` : undefined)}
        {r.hasSok && line("ฌาปนกิจ สสอค.", s.benefitSok)}
        {r.hasScs && line("ฌาปนกิจ สส.ชสอ.", s.benefitScs)}
        {r.hasSst && line("ฌาปนกิจ สส.สท.", s.benefitSst)}
        {r.hasSsk && line("ฌาปนกิจ สส.สก.", s.benefitSsk)}
        {line(
          "สวัสดิการสหกรณ์",
          r.welfare,
          `(${r.sharePeriods ?? 0} งวด × ${baht(s.welfarePerPeriod)}${r.welfareCapped ? " · เต็มเพดาน" : ""})`
        )}
        <div className="border-t border-slate-200 pt-1 font-medium">{line("หลักประกันรวม", r.total)}</div>
        {line(
          "หนี้รวม",
          r.debt,
          r.fileShares != null && (r.fileDebt ?? 0) !== r.debt ? `(ไฟล์ปี ${baht(r.fileDebt ?? 0)})` : undefined
        )}
        <div className={`flex justify-between font-semibold ${r.margin < 0 ? "text-red-600" : "text-emerald-700"}`}>
          <span>เหลือ</span>
          <span className="num">{signed(r.margin)}</span>
        </div>
      </div>
      <div className="space-y-2 text-slate-600">
        <p>
          หักเบี้ยประกันจากปันผล:{" "}
          <span className={r.premiumDeducted === false ? "text-red-600" : ""}>
            {r.premiumDeducted == null ? "ไม่มีในรายชื่อปันผล" : r.premiumDeducted ? "หักได้" : "หักไม่ได้"}
          </span>
        </p>
        {r.undeducted && <p>รายการที่หักไม่ได้: {r.undeducted}</p>}
        {r.relativeCount > 0 && (
          <p>
            ญาติในฌาปนกิจ {r.relativeCount} ราย ค่าบำรุงรวม {baht(r.relativeFees)} บาท (ไม่นับเป็นหลักประกัน)
          </p>
        )}
        {r.debtStatus && <p className="text-amber-700">หมายเหตุ: {r.debtStatus}</p>}
        {r.notInShareReport && (
          <p className="text-amber-700">ไม่มีในรายงานหุ้นหนี้ล่าสุด — หุ้นและหนี้ยังเป็นยอดตามไฟล์ปี</p>
        )}
      </div>
    </div>
  );
}

export default function CoveragePanel() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [summary, setSummary] = useState<CoverageSummary | null>(null);
  const [rows, setRows] = useState<CoverageRow[]>([]);
  const [total, setTotal] = useState(0);
  const [listTotals, setListTotals] = useState<CoverageTotals | null>(null);
  const [units, setUnits] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [band, setBand] = useState<number | null>(null);
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [status, setStatus] = useState<"" | "short" | "ok">("");
  const [premium, setPremium] = useState<"" | "ok" | "fail">("");
  const [assoc, setAssoc] = useState<string>("");
  const [sort, setSort] = useState("margin");
  // The whole file by default; narrowed to policy holders or cremation-only
  // members from the select.
  const [insured, setInsured] = useState<"yes" | "no" | "all">("all");
  const [undeducted, setUndeducted] = useState<"" | "any" | "cremation" | "relative" | "premium">("");
  // The yearly file with the applications recorded since laid over it
  // (สมัครประกัน/ฌาปนกิจ), or the file as it was imported.
  const [withEnrollments, setWithEnrollments] = useState(true);
  const [changedOnly, setChangedOnly] = useState(false);
  // Shares and debt from the latest monthly report, or the yearly file's.
  const [useShareReport, setUseShareReport] = useState(true);
  const [shareReport, setShareReport] = useState<ShareReportInfo | null>(null);
  const [shareReportApplied, setShareReportApplied] = useState(false);
  const [sharesOpen, setSharesOpen] = useState(false);
  const [loanOpen, setLoanOpen] = useState(false);

  // Which round is shown: null is the current one.
  const [snapshots, setSnapshots] = useState<SnapshotListItem[]>([]);
  const [viewId, setViewId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [roundError, setRoundError] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  const params = useCallback(
    (extra?: Record<string, string>) => {
      const p = new URLSearchParams();
      if (search) p.set("search", search);
      if (band != null) {
        p.set("ageFrom", String(AGE_BANDS[band].from));
        p.set("ageTo", String(AGE_BANDS[band].to));
      }
      for (const u of selectedUnits) p.append("unit", u);
      if (status) p.set("status", status);
      if (premium) p.set("premium", premium);
      if (assoc) p.set("assoc", assoc);
      p.set("insured", insured);
      if (!withEnrollments) p.set("enrollments", "0");
      if (changedOnly && withEnrollments) p.set("changed", "1");
      if (!useShareReport) p.set("shares", "0");
      if (undeducted) p.set("undeducted", undeducted);
      if (viewId) p.set("snapshot", viewId);
      p.set("sort", sort);
      if (extra) for (const [k, v] of Object.entries(extra)) p.set(k, v);
      return p;
    },
    [search, band, selectedUnits, status, premium, assoc, sort, insured, undeducted, viewId, withEnrollments, changedOnly, useShareReport]
  );

  const fetchSummary = useCallback(async () => {
    const q = new URLSearchParams();
    if (viewId) q.set("snapshot", viewId);
    if (!withEnrollments) q.set("enrollments", "0");
    if (!useShareReport) q.set("shares", "0");
    const res = await fetch(`/api/coverage/summary?${q}`);
    const body = await res.json();
    setSnapshot(body.snapshot);
    setSummary(body.summary);
    setShareReport(body.shareReport ?? null);
    setShareReportApplied(!!body.shareReportApplied);
  }, [viewId, withEnrollments, useShareReport]);

  const fetchSnapshots = useCallback(async () => {
    const res = await fetch("/api/coverage/snapshots");
    const body = await res.json();
    setSnapshots(body.data ?? []);
  }, []);

  useEffect(() => {
    fetchSnapshots();
  }, [fetchSnapshots]);

  const makeCurrent = async () => {
    if (!snapshot) return;
    setRoundError(null);
    const res = await fetch(`/api/coverage/snapshots/${snapshot.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isCurrent: true }),
    });
    if (!res.ok) setRoundError("ตั้งเป็นรอบหลักไม่สำเร็จ");
    setViewId(null);
    await fetchSnapshots();
  };

  const deleteRound = async () => {
    if (!snapshot) return;
    setConfirmDelete(false);
    setRoundError(null);
    const res = await fetch(`/api/coverage/snapshots/${snapshot.id}`, { method: "DELETE" });
    if (!res.ok) setRoundError("ลบรอบไม่สำเร็จ");
    setViewId(null);
    await fetchSnapshots();
    await Promise.all([fetchSummary(), fetchList()]);
  };

  const fetchList = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/coverage?${params({ page: String(page), pageSize: String(PAGE_SIZE) })}`);
    const body = await res.json();
    setRows(body.data ?? []);
    setTotal(body.total ?? 0);
    setListTotals(body.totals ?? null);
    setUnits(body.units ?? []);
    setLoading(false);
  }, [params, page]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);
  useEffect(() => {
    fetchList();
  }, [fetchList]);
  useEffect(() => {
    setPage(1);
  }, [search, band, selectedUnits, status, premium, assoc, sort, insured, undeducted, viewId, withEnrollments, changedOnly, useShareReport]);

  const onImport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch("/api/coverage/import", { method: "POST", body: new FormData(e.currentTarget) });
      const body = await res.json();
      setImportResult(res.ok ? body : { error: body.error || "นำเข้าไม่สำเร็จ" });
      if (res.ok) {
        setImportOpen(false);
        setViewId(null);
        await Promise.all([fetchSummary(), fetchList(), fetchSnapshots()]);
      }
    } finally {
      setImporting(false);
    }
  };

  const exportCsv = async () => {
    const res = await fetch(`/api/coverage?${params({ all: "1" })}`);
    const body = await res.json();
    downloadCsv(body.data ?? [], snapshot?.label ?? "รอบปัจจุบัน");
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const select = "border border-slate-300 rounded px-2 py-1.5 text-sm bg-white";

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">ประกันและหลักประกัน</h2>
            <PanelHelp summary="สมาชิกที่ทำประกันชีวิตกลุ่ม: หนี้เทียบกับหลักประกัน (หุ้น + ทุนประกัน + ฌาปนกิจของเจ้าตัว + สวัสดิการสหกรณ์)">
              <p>
                หลักประกันรวม = หุ้น + ทุนประกันชีวิต + เงินสงเคราะห์ฌาปนกิจเฉพาะสมาคมที่เจ้าตัวเป็นสมาชิก
                {snapshot &&
                  ` (สสอค ${baht(snapshot.benefitSok)} / สส.ชสอ ${baht(snapshot.benefitScs)} / สส.สท ${baht(snapshot.benefitSst)} / สส.สก ${baht(snapshot.benefitSsk)})`}{" "}
                + สวัสดิการสหกรณ์ (งวดหุ้น × {baht(snapshot?.welfarePerPeriod ?? 2500)} ไม่เกิน{" "}
                {baht(snapshot?.welfareCap ?? 600000)}) ฌาปนกิจของญาติไม่นับ
              </p>
              <p className="mt-1">
                นำเข้าจากไฟล์ สมาชิกทำประกันและฌาปนกิจ_ปี.xlsx (ชีต &quot;รายชื่อ&quot;) อ่านคอลัมน์จากหัวตาราง
                นำเข้าแต่ละครั้งเป็นรอบใหม่ รอบเก่ายังเก็บไว้
              </p>
            </PanelHelp>
            {snapshot && (
              <p className="text-xs text-slate-500 mt-1">
                รอบ: <span className="font-medium text-slate-700">{snapshot.label}</span> · หุ้นหนี้ ณ{" "}
                {shareReportApplied && shareReport ? (
                  <span className="text-emerald-700">
                    {thaiDate(shareReport.asOf)} (รายงานหุ้นหนี้ &quot;{shareReport.label}&quot;)
                  </span>
                ) : (
                  thaiDate(snapshot.asOf)
                )}{" "}
                · อายุ ณ {thaiDate(snapshot.ageAsOf)} · นำเข้า {thaiDate(snapshot.createdAt)}
              </p>
            )}
            {snapshots.length > 0 && snapshot && (
              <div className="flex flex-wrap items-center gap-2 mt-2 text-sm">
                <span className="text-slate-500">ดูรอบ:</span>
                <select
                  value={snapshot.id}
                  onChange={(e) => {
                    const chosen = snapshots.find((s) => s.id === e.target.value);
                    setViewId(chosen?.isCurrent ? null : e.target.value);
                  }}
                  className={select}
                >
                  {snapshots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} · {s._count.members.toLocaleString("th-TH")} ราย · นำเข้า {thaiDate(s.createdAt)}
                      {s.isCurrent ? " (รอบหลัก)" : ""}
                    </option>
                  ))}
                </select>
                {!snapshots.find((s) => s.id === snapshot.id)?.isCurrent && (
                  <button
                    type="button"
                    onClick={makeCurrent}
                    className="px-2 py-1 text-xs rounded border border-blue-300 text-blue-700 hover:bg-blue-50"
                    title="ให้แท็บนี้เปิดรอบนี้เป็นค่าเริ่มต้น"
                  >
                    ตั้งเป็นรอบหลัก
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="px-2 py-1 text-xs rounded border border-red-200 text-red-700 hover:bg-red-50"
                >
                  ลบรอบนี้
                </button>
                {roundError && <span className="text-xs text-red-600">{roundError}</span>}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setLoanOpen((v) => !v)}
              className="px-3 py-1.5 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700"
            >
              คำนวณก่อนกู้
            </button>
            <button
              type="button"
              onClick={() => setSharesOpen((v) => !v)}
              className="px-3 py-1.5 text-sm rounded border border-blue-300 text-blue-700 hover:bg-blue-50"
            >
              รายงานหุ้นหนี้รายเดือน
            </button>
            <button
              type="button"
              onClick={() => setImportOpen((v) => !v)}
              className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
            >
              นำเข้าไฟล์ปี
            </button>
          </div>
        </div>

        {loanOpen && <LoanCollateralCalculator />}
        {sharesOpen && (
          <ShareDebtReports
            onChange={() => {
              fetchSummary();
              fetchList();
            }}
          />
        )}

        {importOpen && (
          <form onSubmit={onImport} className="mt-4 grid gap-3 sm:grid-cols-4 items-end text-sm">
            <label className="sm:col-span-4">
              <span className="block text-slate-600 mb-1">ไฟล์ Excel</span>
              <input type="file" name="file" accept=".xlsx,.xls" required className="text-sm" />
            </label>
            <label>
              <span className="block text-slate-600 mb-1">ชื่อรอบ</span>
              <input name="label" placeholder="ประกันปี 2570 / หุ้นหนี้ 10/69" className={`${select} w-full`} />
            </label>
            <label>
              <span className="block text-slate-600 mb-1">หุ้นหนี้ ณ วันที่</span>
              <input type="date" name="asOf" className={`${select} w-full`} />
            </label>
            <label>
              <span className="block text-slate-600 mb-1">อายุ ณ วันที่</span>
              <input type="date" name="ageAsOf" className={`${select} w-full`} />
            </label>
            <button
              type="submit"
              disabled={importing}
              className="px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50"
            >
              {importing ? "กำลังนำเข้า…" : "นำเข้า"}
            </button>
          </form>
        )}

        {importResult && (
          <div
            className={`mt-3 text-sm rounded p-3 ${importResult.error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}
          >
            {importResult.error ? (
              importResult.error
            ) : (
              <>
                นำเข้า {importResult.imported?.toLocaleString("th-TH")} ราย เป็นรอบ &quot;{importResult.label}&quot;
                {!!importResult.unknownMemberCount && (
                  <p className="mt-1 text-amber-700">
                    ไม่พบในทะเบียนสมาชิก {importResult.unknownMemberCount} ราย:{" "}
                    {importResult.unknownMembers?.join(", ")}
                  </p>
                )}
                {!!importResult.problemCount &&
                  importResult.problems?.map((p) => (
                    <p key={p.rowNumber} className="text-amber-700">
                      แถว {p.rowNumber}: {p.reason}
                    </p>
                  ))}
              </>
            )}
          </div>
        )}
      </section>

      {!snapshot && !loading && (
        <p className="text-sm text-slate-500">ยังไม่มีข้อมูล — กด &quot;นำเข้าไฟล์ปี&quot; เพื่อเริ่ม</p>
      )}

      {summary && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card
              title="ทำประกันชีวิต"
              value={`${summary.all.count.toLocaleString("th-TH")} คน`}
              sub={
                `ทุนรวม ${million(summary.all.insuredSum)}` +
                (summary.uninsured?.count
                  ? ` · ไม่มีประกัน (ฌาปนกิจอย่างเดียว) ${summary.uninsured.count.toLocaleString("th-TH")} คน ไม่นับรวม`
                  : "") +
                (summary.changedSinceFile
                  ? ` · รวมสมัคร/ยกเลิกหลังไฟล์ปี ${summary.changedSinceFile.toLocaleString("th-TH")} คน` +
                    (summary.newSinceFile ? ` (คนใหม่ ${summary.newSinceFile.toLocaleString("th-TH")})` : "")
                  : "")
              }
            />
            <Card
              title="มีหนี้"
              value={`${summary.withDebt.count.toLocaleString("th-TH")} คน`}
              sub={
                `หนี้รวม ${million(summary.all.debt)}` +
                (shareReportApplied && shareReport ? ` · ณ ${thaiDate(shareReport.asOf)}` : "") +
                (summary.notInShareReport ? ` · ไม่มีในรายงานหุ้นหนี้ ${summary.notInShareReport.toLocaleString("th-TH")} คน` : "")
              }
            />
            <Card title="หลักประกันไม่พอ" value={`${summary.short.count.toLocaleString("th-TH")} คน`} sub={`หนี้ ${million(summary.short.debt)}`} tone="bad" />
            <Card
              title="ขาดรวม"
              value={million(summary.short.margin)}
              sub={
                `หักเบี้ยประกันจากปันผลไม่ได้ ${summary.premiumFailed} คน` +
                (summary.cremationFailed ? ` · ฌาปนกิจหักไม่ได้ ${summary.cremationFailed} คน` : "")
              }
              tone="bad"
            />
          </div>

          <section className="bg-white rounded-lg shadow p-4 overflow-x-auto">
            <h3 className="font-medium mb-2">แยกตามช่วงอายุ</h3>
            <table className="w-full text-sm">
              <thead className="text-slate-500 border-b">
                <tr>
                  <th className="text-left py-1.5">อายุ</th>
                  <th className="text-right">คน</th>
                  <th className="text-right">หุ้น</th>
                  <th className="text-right">หนี้</th>
                  <th className="text-right">ทุนประกัน</th>
                  <th className="text-right">ฌาปนกิจ</th>
                  <th className="text-right">สวัสดิการ</th>
                  <th className="text-right">หลักประกันเหลือ</th>
                  <th className="text-right">ไม่พอ (คน)</th>
                </tr>
              </thead>
              <tbody className="num">
                {summary.bands.map((b, i) => (
                  <tr
                    key={b.label}
                    onClick={() => setBand(band === i ? null : i)}
                    className={`border-b last:border-0 cursor-pointer hover:bg-slate-50 ${band === i ? "bg-blue-50" : ""}`}
                  >
                    <td className="py-1.5">{b.label}</td>
                    <td className="text-right">{b.count.toLocaleString("th-TH")}</td>
                    <td className="text-right">{million(b.shares)}</td>
                    <td className="text-right">{million(b.debt)}</td>
                    <td className="text-right">{million(b.insuredSum)}</td>
                    <td className="text-right">{million(b.cremation)}</td>
                    <td className="text-right">{million(b.welfare)}</td>
                    <td className={`text-right ${b.margin < 0 ? "text-red-600" : ""}`}>{million(b.margin)}</td>
                    <td className="text-right text-red-600">{b.shortCount || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-400 mt-2">คลิกแถวเพื่อกรองรายชื่อด้านล่างตามช่วงอายุ</p>
          </section>
        </>
      )}

      {snapshot && <CoverageReconcile snapshotId={viewId} />}

      {snapshot && (
        <section className="bg-white rounded-lg shadow p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="ค้นหาเลขสมาชิก / ชื่อ"
              className={`${select} w-48`}
            />
            <select value={band ?? ""} onChange={(e) => setBand(e.target.value === "" ? null : Number(e.target.value))} className={select}>
              <option value="">ทุกช่วงอายุ</option>
              {AGE_BANDS.map((b, i) => (
                <option key={b.label} value={i}>
                  อายุ {b.label}
                </option>
              ))}
            </select>
            <MultiSelect
              options={units.map((u) => ({ value: u, label: u }))}
              selected={selectedUnits}
              onChange={setSelectedUnits}
              allLabel="ทุกหน่วยงาน"
              searchPlaceholder="ค้นหาหน่วยงาน"
            />
            <select value={insured} onChange={(e) => setInsured(e.target.value as typeof insured)} className={select}>
              <option value="all">ประกันชีวิต: ทั้งหมด</option>
              <option value="yes">มีประกันชีวิต</option>
              <option value="no">ไม่มีประกัน (ฌาปนกิจอย่างเดียว)</option>
            </select>
            <label className="flex items-center gap-1.5 text-sm text-slate-700" title="นับรวมการสมัครและยกเลิกที่บันทึกในแท็บ สมัครประกัน/ฌาปนกิจ หลังวันที่ของไฟล์ปี (ไม่นับรายการที่ไม่อนุมัติ)">
              <input type="checkbox" checked={withEnrollments} onChange={(e) => setWithEnrollments(e.target.checked)} />
              รวมการสมัครหลังไฟล์ปี
            </label>
            {shareReport && (
              <label
                className="flex items-center gap-1.5 text-sm text-slate-700"
                title={`ใช้หุ้น หนี้ และงวดหุ้นจากรายงานหุ้นหนี้ "${shareReport.label}" แทนยอดในไฟล์ปี`}
              >
                <input type="checkbox" checked={useShareReport} onChange={(e) => setUseShareReport(e.target.checked)} />
                ใช้หุ้นหนี้ล่าสุด
              </label>
            )}
            {withEnrollments && (
              <label className="flex items-center gap-1.5 text-sm text-slate-700">
                <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} />
                เฉพาะที่สมัคร/ยกเลิกใหม่
              </label>
            )}
            <select value={undeducted} onChange={(e) => setUndeducted(e.target.value as typeof undeducted)} className={select}>
              <option value="">หักไม่ได้: ทั้งหมด</option>
              <option value="cremation">ฌาปนกิจหักไม่ได้</option>
              <option value="relative">ค่าบำรุงญาติหักไม่ได้</option>
              <option value="premium">เบี้ยประกันหักไม่ได้</option>
              <option value="any">มีรายการหักไม่ได้</option>
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={select}>
              <option value="">หลักประกัน: ทั้งหมด</option>
              <option value="short">ไม่พอ (หนี้เกิน)</option>
              <option value="ok">พอ</option>
            </select>
            <select value={premium} onChange={(e) => setPremium(e.target.value as typeof premium)} className={select}>
              <option value="">เบี้ยประกัน: ทั้งหมด</option>
              <option value="ok">หักจากปันผลได้</option>
              <option value="fail">หักจากปันผลไม่ได้</option>
            </select>
            <select value={assoc} onChange={(e) => setAssoc(e.target.value)} className={select}>
              <option value="">ฌาปนกิจ: ทั้งหมด</option>
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} สมาคม
                </option>
              ))}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className={select}>
              <option value="margin">เรียง: ขาดมากสุดก่อน</option>
              <option value="debt">เรียง: หนี้มากสุดก่อน</option>
              <option value="insured">เรียง: ทุนประกันมากสุดก่อน</option>
              <option value="age">เรียง: อายุมากสุดก่อน</option>
              <option value="member">เรียง: เลขสมาชิก</option>
            </select>
            <button type="button" onClick={exportCsv} className="ml-auto px-3 py-1.5 text-sm rounded border border-slate-300 hover:bg-slate-50">
              ส่งออก CSV
            </button>
          </div>

          {listTotals && (
            <p className="text-xs text-slate-500 num">
              {total.toLocaleString("th-TH")} คน · หนี้ {million(listTotals.debt)} · ทุนประกัน {million(listTotals.insuredSum)} · หลักประกัน {million(listTotals.total)} ·
              เหลือ <span className={listTotals.margin < 0 ? "text-red-600" : ""}>{million(listTotals.margin)}</span>
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-500 border-b">
                <tr>
                  <th className="text-left py-1.5">เลขสมาชิก</th>
                  <th className="text-left">ชื่อ-สกุล</th>
                  <th className="text-right">อายุ</th>
                  <th className="text-right">หุ้น</th>
                  <th className="text-right">หนี้</th>
                  <th className="text-right">ทุนประกัน</th>
                  <th className="text-right">หลักประกันรวม</th>
                  <th className="text-right">เหลือ</th>
                  <th className="text-left pl-3">ฌาปนกิจ</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-slate-400">
                      กำลังโหลด…
                    </td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-slate-400">
                      ไม่พบรายการ
                    </td>
                  </tr>
                )}
                {!loading &&
                  rows.map((r) => (
                    <Fragment key={r.memberNumber}>
                      <tr
                        onClick={() => setExpanded(expanded === r.memberNumber ? null : r.memberNumber)}
                        className="border-b cursor-pointer hover:bg-slate-50"
                      >
                        <td className="py-1.5 num">{r.memberNumber}</td>
                        <td>
                          {r.memberName}
                          <span className="block text-xs text-slate-400">{r.unitName}</span>
                          {r.notInFile && (
                            <span className="block text-xs text-amber-700">ยังไม่มีในไฟล์ปี — หุ้น/หนี้ยังไม่ทราบ</span>
                          )}
                          {r.changes?.map((c, i) => (
                            <span
                              key={i}
                              className={`inline-block text-xs rounded px-1.5 py-0.5 mr-1 mt-0.5 ${
                                c.action === "cancel" ? "bg-slate-200 text-slate-700" : "bg-blue-100 text-blue-800"
                              }`}
                              title={`${ACTIONS[c.action as keyof typeof ACTIONS] ?? c.action} ${ENROLLMENT_PRODUCTS[c.product as EnrollmentProduct] ?? c.product} เมื่อ ${thaiDate(c.date)} · ${STATUSES[c.status as keyof typeof STATUSES] ?? c.status}`}
                            >
                              {c.action === "cancel" ? "ยกเลิก" : "🆕"} {ENROLLMENT_PRODUCTS[c.product as EnrollmentProduct] ?? c.product}
                              {c.status === "pending" ? " (รออนุมัติ)" : ""}
                            </span>
                          ))}
                        </td>
                        <td className="text-right num">{r.age ?? "—"}</td>
                        <td className="text-right num">{baht(r.shares)}</td>
                        <td className="text-right num">{baht(r.debt)}</td>
                        <td className="text-right num">
                          {baht(r.insuredSum)}
                          {r.premium > 0 && (
                            <span className="block text-xs text-slate-400">เบี้ย {baht(r.premium)}</span>
                          )}
                          {r.premiumDeducted === false && (
                            <span
                              className="block text-xs text-red-600"
                              title="หักเบี้ยประกันจากเงินปันผลไม่ได้ — ต้องตามเก็บเบี้ย"
                            >
                              หักจากปันผลไม่ได้
                            </span>
                          )}
                        </td>
                        <td className="text-right num">{baht(r.total)}</td>
                        <td className={`text-right num font-medium ${r.margin < 0 ? "text-red-600" : "text-emerald-700"}`}>
                          {signed(r.margin)}
                        </td>
                        <td className="pl-3 whitespace-nowrap">
                          {(() => {
                            const u = parseUndeducted(r.undeducted);
                            return (
                              <>
                                {ASSOC.filter((a) => r[a.key] || u.associations.includes(a.key)).map((a) =>
                                  u.associations.includes(a.key) ? (
                                    <span
                                      key={a.key}
                                      className="inline-block text-xs rounded px-1.5 py-0.5 mr-1 bg-red-100 text-red-700"
                                      title={`หักค่าบำรุง ${a.label} ไม่ได้`}
                                    >
                                      {a.label} ✗
                                    </span>
                                  ) : (
                                    <span key={a.key} className={`inline-block text-xs rounded px-1.5 py-0.5 mr-1 ${a.cls}`}>
                                      {a.label}
                                    </span>
                                  )
                                )}
                                {u.relatives > 0 && (
                                  <span className="block text-xs text-red-600">ค่าบำรุงญาติหักไม่ได้ {u.relatives} ราย</span>
                                )}
                              </>
                            );
                          })()}
                        </td>
                      </tr>
                      {expanded === r.memberNumber && snapshot && (
                        <tr className="bg-slate-50 border-b">
                          <td colSpan={9} className="p-4">
                            <Breakdown r={r} s={snapshot} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2 text-sm">
            <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="px-2 py-1 border rounded disabled:opacity-40">
              ก่อนหน้า
            </button>
            <span className="num">
              หน้า {page} / {pages}
            </span>
            <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-2 py-1 border rounded disabled:opacity-40">
              ถัดไป
            </button>
          </div>
        </section>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="ลบรอบนี้?"
        description={
          snapshot
            ? `รอบ "${snapshot.label}" และรายชื่อทั้งหมดในรอบนี้จะถูกลบ — ถ้าต้องการกลับมา ต้องนำเข้าไฟล์ใหม่`
            : undefined
        }
        confirmLabel="ลบรอบ"
        onConfirm={deleteRound}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
