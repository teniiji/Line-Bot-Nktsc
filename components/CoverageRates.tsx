"use client";

import { useState } from "react";

// ยอดเงินสงเคราะห์: what each association pays on a member's death, and the
// cooperative's welfare rate — the amounts every collateral total on the tab
// is built from. The four associations and welfare belong to the round
// shown; สสค. to its latest member list. A new round keeps these amounts.

interface Rates {
  id: string;
  label: string;
  benefitSok: number;
  benefitScs: number;
  benefitSst: number;
  benefitSsk: number;
  welfarePerPeriod: number;
  welfareCap: number;
}

const FIELDS: { key: keyof Omit<Rates, "id" | "label">; label: string }[] = [
  { key: "benefitSok", label: "สสอค." },
  { key: "benefitScs", label: "สส.ชสอ." },
  { key: "benefitSst", label: "สส.สท." },
  { key: "benefitSsk", label: "สส.สก." },
  { key: "welfarePerPeriod", label: "สวัสดิการต่องวดหุ้น" },
  { key: "welfareCap", label: "สวัสดิการสูงสุด" },
];

const input = "border border-slate-300 rounded px-2 py-1.5 text-sm bg-white w-32 text-right";
const toInt = (s: string) => Number(s.replace(/[,\s]/g, ""));

export default function CoverageRates({
  snapshot,
  ssc,
  onSaved,
}: {
  snapshot: Rates;
  ssc: { id: string; label: string; benefit: number } | null;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(FIELDS.map((f) => [f.key, String(snapshot[f.key])])),
    ssc: ssc ? String(ssc.benefit) : "",
  }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const values = Object.fromEntries(FIELDS.map((f) => [f.key, toInt(draft[f.key] ?? "")]));
    const bad = FIELDS.find((f) => !Number.isInteger(values[f.key]) || values[f.key] < 0);
    if (bad) return setMessage({ ok: false, text: `${bad.label}: ใส่จำนวนเต็มบาท` });
    const sscBenefit = ssc ? toInt(draft.ssc ?? "") : null;
    if (ssc && (!Number.isInteger(sscBenefit) || (sscBenefit ?? -1) < 0)) return setMessage({ ok: false, text: "สสค.: ใส่จำนวนเต็มบาท" });

    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/coverage/snapshots/${snapshot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "บันทึกไม่สำเร็จ");
      if (ssc && sscBenefit !== ssc.benefit) {
        const r = await fetch(`/api/coverage/ssc/${ssc.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ benefit: sscBenefit }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "บันทึกยอด สสค. ไม่สำเร็จ");
      }
      setMessage({ ok: true, text: "บันทึกแล้ว — คำนวณหลักประกันใหม่ทั้งแท็บ" });
      onSaved();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "บันทึกไม่สำเร็จ" });
    } finally {
      setBusy(false);
    }
  };

  const field = (key: string, label: string) => (
    <label key={key}>
      <span className="block text-slate-600 mb-1">{label}</span>
      <input
        inputMode="numeric"
        value={draft[key] ?? ""}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        className={input}
      />
    </label>
  );

  return (
    <form onSubmit={save} className="mt-4 border-t border-slate-200 pt-4 space-y-3 text-sm">
      <div>
        <p className="font-medium">ยอดเงินสงเคราะห์ (นับเป็นหลักประกัน)</p>
        <p className="text-xs text-slate-500">
          สมาคม 4 แห่งและสวัสดิการเป็นของรอบ &quot;{snapshot.label}&quot; · สสค. เป็นของรายชื่อ สสค. ล่าสุด
          {ssc ? ` "${ssc.label}"` : " (ยังไม่ได้นำเข้า)"} · นำเข้าไฟล์ปีรอบใหม่จะใช้ยอดชุดนี้ต่อ
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {FIELDS.slice(0, 4).map((f) => field(f.key, f.label))}
        {ssc && field("ssc", "สสค.")}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {FIELDS.slice(4).map((f) => field(f.key, f.label))}
        <button type="submit" disabled={busy} className="px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50">
          {busy ? "กำลังบันทึก…" : "บันทึกยอด"}
        </button>
        {message && <span className={message.ok ? "text-emerald-700" : "text-red-600"}>{message.text}</span>}
      </div>
    </form>
  );
}
