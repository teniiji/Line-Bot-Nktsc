"use client";

import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

// รายชื่อสมาชิก สสค. — the association's member list, so its benefit counts
// in each member's collateral (lib/sscRoster.ts).

interface Roster {
  id: string;
  label: string;
  benefit: number;
  memberCount: number;
  fileName: string | null;
  createdAt: string;
  counts: Counts | null;
}

interface Counts {
  rows: number;
  left: number;
  relatives: number;
  noMemberNumber: number;
  notMember: number;
  notPaying: number;
}

interface Result {
  label?: string;
  benefit?: number;
  members?: number;
  counts?: Counts;
  error?: string;
}

const n = (x: number) => x.toLocaleString("th-TH");
const thaiDate = (iso: string) =>
  new Date(iso).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric" });
const input = "border border-slate-300 rounded px-2 py-1.5 text-sm bg-white";

export default function SscRosters({ onChange }: { onChange: () => void }) {
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [toDelete, setToDelete] = useState<Roster | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/coverage/ssc");
    setRosters((await res.json()).data ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const onImport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/coverage/ssc", { method: "POST", body: new FormData(form) });
      const body = await res.json();
      setResult(res.ok ? body : { error: body.error || "นำเข้าไม่สำเร็จ" });
      if (res.ok) {
        form.reset();
        await load();
        onChange();
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    await fetch(`/api/coverage/ssc/${toDelete.id}`, { method: "DELETE" });
    setToDelete(null);
    setResult(null);
    await load();
    onChange();
  };

  const countsText = (c: Counts) =>
    `ไฟล์มี ${n(c.rows)} แถว · ลาออก ${n(c.left)} · ญาติที่ลงใต้เลขสมาชิก ${n(c.relatives)} · ไม่มีเลขสหกรณ์ ${n(c.noMemberNumber)} · เลขสหกรณ์ไม่พบในสมาชิก ${n(c.notMember)}` +
    (c.notPaying ? ` · สมาชิกที่ไม่มียอดส่งรายเดือน ${n(c.notPaying)}` : "");

  return (
    <div className="mt-4 border-t border-slate-200 pt-4 space-y-3 text-sm">
      <div>
        <p className="font-medium">รายชื่อสมาชิก สสค.</p>
        <p className="text-xs text-slate-500">
          ไฟล์รายชื่อที่ส่งออกจากระบบ สสค. (.xls) · นับเฉพาะคนที่สถานะเป็นสมาชิก และเป็นสมาชิกสหกรณ์เอง (เลขสหกรณ์และชื่อตรงกัน)
          ญาติที่ลงไว้ใต้เลขสมาชิกไม่นับ เหมือนสมาคมอื่น · ใช้รายชื่อล่าสุด
        </p>
      </div>
      <form onSubmit={onImport} className="flex flex-wrap items-end gap-2">
        <label>
          <span className="block text-slate-600 mb-1">ไฟล์รายชื่อ สสค.</span>
          <input type="file" name="file" accept=".xls,.xlsx" required className="text-sm" />
        </label>
        <label>
          <span className="block text-slate-600 mb-1">เงินสงเคราะห์ (นับเป็นหลักประกัน)</span>
          <input
            key={rosters[0]?.id ?? "none"}
            name="benefit"
            inputMode="numeric"
            defaultValue={String(rosters[0]?.benefit ?? 270000)}
            required
            className={`${input} w-32`}
          />
        </label>
        <label>
          <span className="block text-slate-600 mb-1">ข้อมูล ณ วันที่</span>
          <input type="date" name="asOf" className={input} />
        </label>
        <label>
          <span className="block text-slate-600 mb-1">ชื่อ</span>
          <input name="label" placeholder="สสค. พ.ย. 69" className={input} />
        </label>
        <button type="submit" disabled={busy} className="px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50">
          {busy ? "กำลังนำเข้า…" : "นำเข้ารายชื่อ สสค."}
        </button>
      </form>

      {result && (
        <div className={`rounded p-3 ${result.error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>
          {result.error ?? (
            <>
              นำเข้า &quot;{result.label}&quot; — สมาชิกสหกรณ์ที่เป็นสมาชิก สสค. เอง <strong>{n(result.members ?? 0)}</strong> คน
              นับเงินสงเคราะห์คนละ {n(result.benefit ?? 0)} บาท
              {result.counts && <p className="text-xs mt-1">ไม่นับ: {countsText(result.counts)}</p>}
            </>
          )}
        </div>
      )}

      {rosters.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-slate-500 text-left">
            <tr>
              <th className="py-1">นำเข้า</th>
              <th>ชื่อ</th>
              <th className="text-right pr-4">สมาชิก</th>
              <th className="text-right pr-4">เงินสงเคราะห์</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rosters.map((r, i) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-1.5 whitespace-nowrap">
                  {thaiDate(r.createdAt)}
                  {i === 0 && <span className="ml-1 text-xs text-emerald-700">(ใช้อยู่)</span>}
                </td>
                <td>
                  {r.label}
                  {r.counts && <span className="block text-xs text-slate-400">{countsText(r.counts)}</span>}
                </td>
                <td className="text-right num pr-4">{n(r.memberCount)}</td>
                <td className="text-right num pr-4">{n(r.benefit)}</td>
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
        title="ลบรายชื่อ สสค."
        description={toDelete ? `ลบ "${toDelete.label}" — หลักประกันจะกลับไปใช้รายชื่อก่อนหน้า หรือไม่นับ สสค.` : undefined}
        confirmLabel="ลบ"
        tone="danger"
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
