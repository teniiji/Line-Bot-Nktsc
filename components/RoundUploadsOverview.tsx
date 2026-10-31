"use client";

import { useEffect, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import type { UnitProgressRow, UnitState } from "@/lib/roundUnitProgress";

// "Which files have we uploaded, and which units are in?" for one round —
// the files from the upload history, the หน่วยคุม from the members' results.
// See app/api/statement-rounds/[id]/uploads.

interface UploadRow {
  id: string;
  kind: string;
  fileName: string;
  uploadedAt: string;
  // Members it changed, when that was kept — null means it can only be
  // taken off the list, not undone (lib/uploadUndo.ts).
  changed: number | null;
  // How many times these same bytes went into the round.
  repeats: number;
}

const KIND_LABEL: Record<string, string> = { list: "รายการหัก", results: "ผลการหัก" };

const STATE_LABEL: Record<UnitState, { text: string; tone: string }> = {
  reported: { text: "✅ ส่งผลแล้ว", tone: "bg-green-50 text-green-700 border-green-200" },
  partial: { text: "🟡 ส่งผลบางส่วน", tone: "bg-amber-50 text-amber-800 border-amber-200" },
  awaiting: { text: "⏳ ยังไม่ส่งผล", tone: "bg-slate-50 text-slate-600 border-slate-200" },
};

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function RoundUploadsOverview({
  roundId,
  refreshKey,
  onChanged,
}: {
  roundId: string;
  refreshKey?: unknown;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<{ uploads: UploadRow[]; units: UnitProgressRow[]; closed?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<UnitState | "all">("all");
  // The file a ยกเลิกผล or ลบออกจากรายการ is waiting to be confirmed for.
  const [pending, setPending] = useState<{ upload: UploadRow; action: "undo" | "forget" } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const act = async () => {
    if (!pending) return;
    const { upload, action } = pending;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/statement-rounds/${roundId}/uploads/${upload.id}${action === "undo" ? "/undo" : ""}`,
        { method: action === "undo" ? "POST" : "DELETE" }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(`⚠️ ${body.error || "ทำไม่สำเร็จ"}`);
        return;
      }
      if (action === "undo") {
        const skipped: { memberNumber: string; reason: string }[] = body.skipped ?? [];
        setNotice(
          `ยกเลิกผลของ ${upload.fileName} แล้ว — คืนค่าเดิม ${body.restored} คน` +
            (body.removed ? ` · เอาคนที่ไฟล์นี้เพิ่มออก ${body.removed} คน` : "") +
            (skipped.length
              ? ` · ไม่ได้แตะ ${skipped.length} คน: ${skipped
                  .slice(0, 8)
                  .map((s) => `${s.memberNumber} (${s.reason})`)
                  .join(", ")}${skipped.length > 8 ? " …" : ""}`
              : "")
        );
        onChanged?.();
      } else {
        setNotice(`ลบ ${upload.fileName} ออกจากรายการแล้ว — ผลการหักที่บันทึกไปไม่เปลี่ยน`);
      }
      setReload((n) => n + 1);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/statement-rounds/${roundId}/uploads`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setError(body.error || "โหลดข้อมูลไม่สำเร็จ");
        else setData(body);
      })
      .catch(() => !cancelled && setError("โหลดข้อมูลไม่สำเร็จ"));
    return () => {
      cancelled = true;
    };
  }, [roundId, refreshKey, reload]);

  if (error) return <p className="px-4 py-3 text-sm text-red-600">{error}</p>;
  if (!data) return <p className="px-4 py-3 text-sm text-slate-500">กำลังโหลด…</p>;

  const count = (state: UnitState) => data.units.filter((u) => u.state === state).length;
  const units = filter === "all" ? data.units : data.units.filter((u) => u.state === filter);

  return (
    <div className="px-4 py-3 space-y-4 text-sm bg-slate-50/60 border-b border-slate-100">
      <div>
        <h3 className="font-medium text-slate-700 mb-1">📂 ไฟล์ที่อัปโหลดเข้ารอบนี้ ({data.uploads.length})</h3>
        {data.uploads.length === 0 ? (
          <p className="text-xs text-slate-500">ยังไม่มีประวัติไฟล์ในรอบนี้</p>
        ) : (
          <table className="w-full bg-white border border-slate-200 rounded">
            <thead className="text-xs text-slate-500 text-left">
              <tr>
                <th className="px-2 py-1.5 font-semibold whitespace-nowrap">อัปโหลดเมื่อ</th>
                <th className="px-2 py-1.5 font-semibold">ประเภท</th>
                <th className="px-2 py-1.5 font-semibold">ชื่อไฟล์</th>
                <th className="px-2 py-1.5 font-semibold text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {data.uploads.map((u, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-2 py-1.5 num text-slate-500 whitespace-nowrap">{formatWhen(u.uploadedAt)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{KIND_LABEL[u.kind] ?? u.kind}</td>
                  <td className="px-2 py-1.5 break-all">
                    {u.fileName}
                    {u.repeats > 1 && (
                      <span
                        className="ml-1.5 inline-block text-xs px-1.5 rounded-full border border-amber-300 bg-amber-50 text-amber-800"
                        title="ไฟล์เนื้อหาเดียวกันนี้อัปเข้ารอบนี้มากกว่าหนึ่งครั้ง"
                      >
                        ซ้ำ ×{u.repeats}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap text-xs">
                    {!!u.changed && !data.closed && (
                      <button
                        type="button"
                        onClick={() => setPending({ upload: u, action: "undo" })}
                        className="text-rose-700 hover:underline mr-3"
                        title="คืนค่าผลการหักของสมาชิกที่ไฟล์นี้บันทึกไว้ ให้กลับไปเป็นเหมือนก่อนอัปไฟล์นี้"
                      >
                        ↩️ ยกเลิกผลของไฟล์นี้
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPending({ upload: u, action: "forget" })}
                      className="text-slate-600 hover:underline"
                      title="เอาชื่อไฟล์ออกจากรายการนี้อย่างเดียว ผลการหักที่บันทึกไปแล้วไม่เปลี่ยน"
                    >
                      ลบออกจากรายการ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {notice && <p className="text-xs mt-1.5 px-2 py-1.5 rounded bg-white border border-slate-200">{notice}</p>}
        <p className="text-xs text-slate-400 mt-1">
          "ยกเลิกผลของไฟล์นี้" ใช้ได้กับไฟล์ผลการหักที่อัปตั้งแต่ 31 ต.ค. 2569 — ไฟล์ก่อนหน้านั้นลบออกจากรายการได้อย่างเดียว ·
          ระบบเริ่มจำชื่อไฟล์ตั้งแต่ 30 ก.ย. 2569 — ไฟล์ที่อัปก่อนหน้านั้นไม่อยู่ในรายการนี้ แต่ผลการหักยังนับในตารางหน่วยคุมด้านล่าง
        </p>
      </div>

      <div>
        <h3 className="font-medium text-slate-700 mb-1">
          🏢 หน่วยคุมที่ส่งผลการหักแล้ว ({count("reported")} จาก {data.units.length})
        </h3>
        <div className="flex flex-wrap gap-2 mb-2 text-xs">
          {(["all", "awaiting", "partial", "reported"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`px-2.5 py-1 rounded-full border ${
                filter === key ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-300"
              }`}
            >
              {key === "all" ? `ทั้งหมด (${data.units.length})` : `${STATE_LABEL[key].text} (${count(key)})`}
            </button>
          ))}
        </div>
        {units.length === 0 ? (
          <p className="text-xs text-slate-500">ไม่มีหน่วยคุมในกลุ่มนี้</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full bg-white border border-slate-200 rounded">
              <thead className="text-xs text-slate-500 text-left">
                <tr>
                  <th className="px-2 py-1.5 font-semibold">หน่วยคุม</th>
                  <th className="px-2 py-1.5 font-semibold text-right">สมาชิก</th>
                  <th className="px-2 py-1.5 font-semibold text-right">หักได้</th>
                  <th className="px-2 py-1.5 font-semibold text-right">หักไม่ได้</th>
                  <th className="px-2 py-1.5 font-semibold text-right">รอผล</th>
                  <th className="px-2 py-1.5 font-semibold">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.key} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-1.5">
                      {u.hCode && <span className="num text-slate-400 mr-1.5">{u.hCode}</span>}
                      {u.name}
                      {u.state === "partial" && u.awaitingUnitNames.length > 0 && (
                        <span className="block text-xs text-amber-800 mt-0.5">
                          ยังไม่ส่ง: {u.awaitingUnitNames.join(", ")}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 num text-right">{u.members.toLocaleString("th-TH")}</td>
                    <td className="px-2 py-1.5 num text-right text-slate-500">{u.collected.toLocaleString("th-TH")}</td>
                    <td className="px-2 py-1.5 num text-right text-slate-500">{u.uncollected.toLocaleString("th-TH")}</td>
                    <td className="px-2 py-1.5 num text-right">{u.awaiting > 0 ? u.awaiting.toLocaleString("th-TH") : "—"}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${STATE_LABEL[u.state].tone}`}>
                        {STATE_LABEL[u.state].text}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={pending !== null}
        tone={pending?.action === "undo" ? "danger" : "neutral"}
        title={
          pending?.action === "undo"
            ? `ยกเลิกผลของ ${pending.upload.fileName}?`
            : `ลบ ${pending?.upload.fileName ?? ""} ออกจากรายการ?`
        }
        description={
          pending?.action === "undo"
            ? `สมาชิก ${pending.upload.changed} คนที่ไฟล์นี้บันทึกผลการหัก จะกลับไปเป็นเหมือนก่อนอัปไฟล์นี้ (เช่น กลับเป็น "รอผลการหัก") และคนที่ไฟล์นี้เพิ่มเข้ารอบจะถูกเอาออก — ยกเว้นคนที่ถูกไฟล์อื่นหรือเจ้าหน้าที่แก้ไปแล้ว หรือมีเงินโอนผูกอยู่ ระบบจะไม่แตะ ชื่อไฟล์จะหายจากรายการด้วย`
            : "ลบแค่ชื่อไฟล์ออกจากรายการนี้ ผลการหักที่ไฟล์นี้บันทึกไปแล้วยังอยู่เหมือนเดิม — ถ้าต้องการเอาผลออกด้วย ใช้ \"ยกเลิกผลของไฟล์นี้\""
        }
        confirmLabel={busy ? "กำลังทำ…" : pending?.action === "undo" ? "ยกเลิกผล" : "ลบออกจากรายการ"}
        onConfirm={act}
        onCancel={() => !busy && setPending(null)}
      />
    </div>
  );
}
