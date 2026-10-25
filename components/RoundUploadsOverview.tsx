"use client";

import { useEffect, useState } from "react";
import type { UnitProgressRow, UnitState } from "@/lib/roundUnitProgress";

// "Which files have we uploaded, and which units are in?" for one round —
// the files from the upload history, the หน่วยคุม from the members' results.
// See app/api/statement-rounds/[id]/uploads.

interface UploadRow {
  kind: string;
  fileName: string;
  uploadedAt: string;
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

export default function RoundUploadsOverview({ roundId, refreshKey }: { roundId: string; refreshKey?: unknown }) {
  const [data, setData] = useState<{ uploads: UploadRow[]; units: UnitProgressRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<UnitState | "all">("all");

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
  }, [roundId, refreshKey]);

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
              </tr>
            </thead>
            <tbody>
              {data.uploads.map((u, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-2 py-1.5 num text-slate-500 whitespace-nowrap">{formatWhen(u.uploadedAt)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{KIND_LABEL[u.kind] ?? u.kind}</td>
                  <td className="px-2 py-1.5 break-all">{u.fileName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-slate-400 mt-1">
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
    </div>
  );
}
