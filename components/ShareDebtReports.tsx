"use client";

import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { parseShareDebtPdf, ShareDebtPdfError, type PdfCheck } from "@/lib/shareDebtPdf";

// รายงานหุ้นหนี้รายเดือน — import the month's report so the coverage tab's
// shares and debt are this month's, not the yearly file's (lib/shareDebt.ts).

interface Report {
  id: string;
  label: string;
  asOf: string;
  fileName: string | null;
  debtColumns: string | null;
  memberCount: number;
  createdAt: string;
}

interface ImportResult {
  label?: string;
  imported?: number;
  duplicates?: number;
  debtColumns?: string[];
  sharesColumn?: string | null;
  periodsColumn?: string | null;
  error?: string;
  // For a PDF: the figures read against the report's own grand total.
  checks?: PdfCheck[];
  resigned?: number;
}

const isPdf = (f: File) => /\.pdf$/i.test(f.name) || f.type === "application/pdf";
const num = (x: number | null) => (x == null ? "ไม่พบในรายงาน" : x.toLocaleString("th-TH", { maximumFractionDigits: 2 }));

const thaiDate = (iso: string) =>
  new Date(iso).toLocaleDateString("th-TH", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const input = "border border-slate-300 rounded px-2 py-1.5 text-sm bg-white";

export default function ShareDebtReports({ onChange }: { onChange: () => void }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [toDelete, setToDelete] = useState<Report | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/coverage/share-reports");
    setReports((await res.json()).data ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const onImport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    setBusy(true);
    setResult(null);
    try {
      if (file instanceof File && isPdf(file)) {
        await importPdf(file, data);
        form.reset();
        return;
      }
      const res = await fetch("/api/coverage/share-reports", { method: "POST", body: data });
      const body = await res.json();
      setResult(res.ok ? body : { error: body.error || "นำเข้าไม่สำเร็จ" });
      if (res.ok) {
        form.reset();
        await load();
        onChange();
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // The printed report is too big to send, so it is read here and only the
  // figures go to the server — and only when they add up to the report's own
  // grand total.
  const importPdf = async (file: File, data: FormData) => {
    let parsed;
    try {
      setProgress("กำลังเปิด PDF…");
      const { readPdfTextItems } = await import("@/lib/pdfTextItems");
      const items = await readPdfTextItems(file, (p, n) => setProgress(`กำลังอ่าน PDF หน้า ${p.toLocaleString("th-TH")} / ${n.toLocaleString("th-TH")}`));
      parsed = parseShareDebtPdf(items);
    } catch (err) {
      setResult({
        error:
          err instanceof ShareDebtPdfError
            ? err.message
            : "อ่านไฟล์ PDF ไม่ได้ — ไฟล์อาจเสียหาย หรือเป็นรูปสแกน (ต้องเป็น PDF ที่พิมพ์จากระบบ)",
      });
      return;
    }
    if (!parsed.ok) {
      setResult({
        error: "ยอดที่อ่านได้ไม่ตรงกับยอดรวมท้ายรายงาน จึงยังไม่นำเข้า — รูปแบบรายงานอาจเปลี่ยน แจ้งผู้ดูแลระบบ",
        checks: parsed.checks,
      });
      return;
    }
    setProgress("กำลังบันทึก…");
    const res = await fetch("/api/coverage/share-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asOf: data.get("asOf"),
        label: data.get("label"),
        fileName: file.name,
        entries: parsed.entries,
      }),
    });
    const body = await res.json();
    setResult(res.ok ? { ...body, checks: parsed.checks, resigned: parsed.resigned } : { error: body.error || "นำเข้าไม่สำเร็จ" });
    if (res.ok) {
      await load();
      onChange();
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    await fetch(`/api/coverage/share-reports/${toDelete.id}`, { method: "DELETE" });
    setToDelete(null);
    setResult(null);
    await load();
    onChange();
  };

  return (
    <div className="mt-4 border-t border-slate-200 pt-4 space-y-3 text-sm">
      <div>
        <p className="font-medium">รายงานหุ้นหนี้รายเดือน</p>
        <p className="text-xs text-slate-500">
          ใช้แทนยอดหุ้น หนี้ และงวดหุ้นในไฟล์ปี ส่วนทุนประกัน ฌาปนกิจ และรายการหักไม่ได้ยังใช้ตามไฟล์ปี
          อัปโหลด <b>PDF &quot;รายงานหุ้นและหนี้คงเหลือ&quot;</b> ที่พิมพ์จากระบบได้โดยตรง
          (ระบบอ่านในเครื่องนี้ แล้วเทียบกับยอดรวมท้ายรายงานก่อนบันทึก) หรือไฟล์ Excel ที่มีหัวตาราง
          &quot;เลขสมาชิก&quot; &quot;หุ้น&quot; &quot;หนี้รวม&quot; และ &quot;งวดหุ้น&quot;
        </p>
      </div>
      <form onSubmit={onImport} className="flex flex-wrap items-end gap-2">
        <label>
          <span className="block text-slate-600 mb-1">ไฟล์ PDF หรือ Excel</span>
          <input type="file" name="file" accept=".pdf,.xlsx,.xls" required className="text-sm" />
        </label>
        <label>
          <span className="block text-slate-600 mb-1">ยอด ณ วันที่</span>
          <input type="date" name="asOf" required className={input} />
        </label>
        <label>
          <span className="block text-slate-600 mb-1">ชื่อ</span>
          <input name="label" placeholder="หุ้นหนี้ ต.ค. 69" className={input} />
        </label>
        <button type="submit" disabled={busy} className="px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50">
          {busy ? "กำลังนำเข้า…" : "นำเข้ารายงานหุ้นหนี้"}
        </button>
        {progress && <span className="text-xs text-slate-500 self-center">{progress}</span>}
      </form>

      {result && (
        <div className={`rounded p-3 ${result.error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>
          {result.error ?? (
            <>
              นำเข้า &quot;{result.label}&quot; {result.imported?.toLocaleString("th-TH")} ราย
              {result.checks ? (
                <p className="text-xs mt-1">
                  อ่านจาก PDF: หุ้นจากช่องทุนเรือนหุ้น · หนี้จากช่องรวม · งวดหุ้นจากช่องหุ้น/เดือน
                  {!!result.resigned && ` · ลาออก ${result.resigned} ราย`} · ใครไม่มียอดหุ้นหรืองวดหุ้นในรายงาน ใช้ตามไฟล์ปี
                </p>
              ) : (
              <p className="text-xs mt-1">
                หนี้จากคอลัมน์: {result.debtColumns?.length ? result.debtColumns.join(" + ") : "— (ไม่มี ใช้หนี้ตามไฟล์ปี)"} · หุ้นจาก:{" "}
                {result.sharesColumn ?? "— (ใช้ตามไฟล์ปี)"} · งวดหุ้นจาก: {result.periodsColumn ?? "— (ใช้ตามไฟล์ปี)"}
                {!!result.duplicates && ` · เลขสมาชิกซ้ำ ${result.duplicates} แถว (ใช้แถวแรก)`}
              </p>
              )}
              {!result.checks && <p className="text-xs">ถ้าคอลัมน์ไม่ถูก ลบรายงานนี้ แล้วแก้หัวตารางในไฟล์ก่อนนำเข้าใหม่</p>}
            </>
          )}
          {result.checks && (
            <table className="mt-2 text-xs text-slate-700">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="pr-4">เทียบกับยอดรวมท้ายรายงาน</th>
                  <th className="pr-4 text-right">อ่านได้</th>
                  <th className="pr-4 text-right">ในรายงาน</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {result.checks.map((c) => (
                  <tr key={c.label}>
                    <td className="pr-4">{c.label}</td>
                    <td className="pr-4 text-right num">{num(c.read)}</td>
                    <td className="pr-4 text-right num">{num(c.report)}</td>
                    <td className={c.ok ? "text-emerald-700" : "text-red-700"}>{c.ok ? "✓ ตรง" : "✗ ไม่ตรง"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {reports.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-slate-500 text-left">
            <tr>
              <th className="py-1">ยอด ณ</th>
              <th>ชื่อ</th>
              <th className="text-right pr-4">สมาชิก</th>
              <th>หนี้จากคอลัมน์</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r, i) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-1.5 whitespace-nowrap">
                  {thaiDate(r.asOf)}
                  {i === 0 && <span className="ml-1 text-xs text-emerald-700">(ใช้อยู่)</span>}
                </td>
                <td>{r.label}</td>
                <td className="text-right num pr-4">{r.memberCount.toLocaleString("th-TH")}</td>
                <td className="text-xs text-slate-500">{r.debtColumns ?? "—"}</td>
                <td className="text-right">
                  <button type="button" onClick={() => setToDelete(r)} className="text-xs text-red-700 hover:underline">
                    ลบ
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ConfirmDialog
        open={!!toDelete}
        title="ลบรายงานหุ้นหนี้"
        description={toDelete ? `ลบรายงาน "${toDelete.label}" — แท็บนี้จะกลับไปใช้รายงานก่อนหน้าหรือยอดตามไฟล์ปี` : undefined}
        confirmLabel="ลบ"
        tone="danger"
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
