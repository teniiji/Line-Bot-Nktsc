"use client";

import { useRef, useState } from "react";

// "ผูกตามที่แนะนำทั้งหมด" and the สมาชิก_LINE_OA import, on the สมาชิก LINE
// tab. Both show what would happen first and write only on confirm — see
// lib/lineLinking.ts for what is refused and why.

interface Outcome {
  lineUserId: string;
  memberNumber: string;
  action: "link" | "already" | "skip";
  label: string;
  memberName: string | null;
  reason: string | null;
}

interface Result {
  applied: boolean;
  linked: number;
  counts: { link: number; already: number; skip: number; badIds: number };
  outcomes: Outcome[];
  more: number;
}

type Source = { kind: "suggested" } | { kind: "sheet"; file: File };

export default function LineLinkBulk({ onDone }: { onDone: () => void }) {
  const [source, setSource] = useState<Source | null>(null);
  const [preview, setPreview] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (src: Source, apply: boolean): Promise<Result | null> => {
    setBusy(true);
    setError(null);
    try {
      let res: Response;
      if (src.kind === "sheet") {
        const form = new FormData();
        form.append("file", src.file);
        if (apply) form.append("apply", "1");
        res = await fetch("/api/line-users/link", { method: "POST", body: form });
      } else {
        res = await fetch("/api/line-users/link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: "suggested", apply }),
        });
      }
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      return body as Result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const start = async (src: Source) => {
    setDone(null);
    setSource(src);
    setPreview(await run(src, false));
  };

  const confirm = async () => {
    if (!source) return;
    const result = await run(source, true);
    if (!result) return;
    setDone(`ผูกแล้ว ${result.linked} คน — บอทจะรู้จักคนเหล่านี้โดยไม่ต้องถามชื่อและเลขสมาชิกอีก`);
    setPreview(null);
    setSource(null);
    onDone();
  };

  const close = () => {
    setPreview(null);
    setSource(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const skipped = preview?.outcomes.filter((o) => o.action === "skip") ?? [];
  const reasons = Object.entries(
    skipped.reduce<Record<string, number>>((acc, o) => ({ ...acc, [o.reason ?? "-"]: (acc[o.reason ?? "-"] ?? 0) + 1 }), {})
  );

  return (
    <div className="px-4 py-2.5 border-b border-slate-100 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-slate-600">ผูกเลขสมาชิกทีละหลายคน:</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => start({ kind: "suggested" })}
          className="text-xs px-2.5 py-1.5 border border-emerald-300 text-emerald-800 rounded hover:bg-emerald-50 disabled:opacity-40"
        >
          ผูกตามที่แนะนำทั้งหมด
        </button>
        <label className="text-xs px-2.5 py-1.5 border border-slate-300 text-slate-700 rounded hover:bg-slate-50 cursor-pointer">
          นำเข้า LINE UserID จากชีต สมาชิก_LINE_OA
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) start({ kind: "sheet", file });
            }}
          />
        </label>
        {busy ? <span className="text-xs text-slate-500">กำลังตรวจ…</span> : null}
      </div>
      {error ? <p className="mt-2 text-red-600">{error}</p> : null}
      {done ? <p className="mt-2 text-emerald-700">✅ {done}</p> : null}

      {preview ? (
        <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 space-y-2">
          <p className="font-medium">
            {source?.kind === "sheet" ? "จากชีต สมาชิก_LINE_OA" : "จากข้อเสนอ \"อาจเป็น …\""}: ผูกได้{" "}
            <strong>{preview.counts.link}</strong> คน · ผูกไว้แล้ว {preview.counts.already} · ข้าม {preview.counts.skip}
            {preview.counts.badIds ? ` · LINE UserID รูปแบบไม่ถูกต้อง ${preview.counts.badIds}` : ""}
          </p>
          {source?.kind === "sheet" ? (
            <p className="text-xs text-slate-500">
              ใช้เฉพาะ LINE UserID ของคนที่เคยทักบอทนี้แล้ว (เป็น ID ของ LINE OA ปัจจุบันแน่นอน) — ID จาก OA เดิมหรือคนที่ยังไม่เคยทักจะถูกข้าม
            </p>
          ) : null}
          {preview.counts.link > 0 ? (
            <div className="max-h-64 overflow-y-auto rounded bg-white border border-slate-200">
              <table className="w-full text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="text-left px-2 py-1">บัญชี LINE</th>
                    <th className="text-left px-2 py-1">จะผูกกับ</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.outcomes
                    .filter((o) => o.action === "link")
                    .map((o) => (
                      <tr key={o.lineUserId} className="border-t border-slate-100">
                        <td className="px-2 py-1">{o.label}</td>
                        <td className="px-2 py-1">
                          {o.memberName} ({o.memberNumber})
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-slate-600">ไม่มีรายการที่ผูกเพิ่มได้</p>
          )}
          {reasons.length ? (
            <ul className="text-xs text-slate-600 list-disc pl-5">
              {reasons.map(([reason, n]) => (
                <li key={reason}>
                  ข้าม {n}: {reason}
                </li>
              ))}
              {preview.more ? <li>และอีก {preview.more} รายการที่ไม่ได้แสดง</li> : null}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || preview.counts.link === 0}
              onClick={confirm}
              className="text-xs px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              ยืนยันผูก {preview.counts.link} คน
            </button>
            <button type="button" onClick={close} className="text-xs px-3 py-1.5 rounded border border-slate-300">
              ยกเลิก
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
