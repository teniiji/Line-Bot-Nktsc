"use client";

import { useEffect, useState } from "react";
import { ENROLLMENT_PRODUCTS, type EnrollmentProduct } from "@/lib/enrollment";
import type { ReconcileItem, ReconcileKind } from "@/lib/coverageReconcile";

// เทียบไฟล์ปีกับทะเบียนการสมัคร — what the register recorded between the
// previous yearly file and this one, against what this file shows
// (lib/coverageReconcile.ts).

interface Result {
  snapshot: { label: string; date: string } | null;
  previous: { label: string; date: string } | null;
  eventsChecked: number;
  items: ReconcileItem[];
}

const KINDS: { kind: ReconcileKind; title: string; hint: string; tone: string }[] = [
  {
    kind: "missingFromFile",
    title: "สมัครแล้วแต่ไม่มีในไฟล์",
    hint: "ในทะเบียนมีการสมัคร แต่ไฟล์ปีไม่มี — ตรวจกับสมาคมหรือบริษัทประกันว่าตกหล่นไหม",
    tone: "text-red-700",
  },
  {
    kind: "stillInFile",
    title: "ยกเลิกแล้วแต่ยังมีในไฟล์",
    hint: "ในทะเบียนยกเลิกแล้ว แต่ไฟล์ปียังมี — อาจยังถูกเรียกเก็บอยู่",
    tone: "text-red-700",
  },
  {
    kind: "addedWithoutRecord",
    title: "เพิ่มในไฟล์แต่ไม่มีในทะเบียน",
    hint: "ไฟล์นี้มีแต่ไฟล์ก่อนไม่มี และไม่ได้บันทึกการสมัครไว้ — บันทึกย้อนหลังถ้าต้องการให้ครบ",
    tone: "text-amber-700",
  },
  {
    kind: "removedWithoutRecord",
    title: "หายจากไฟล์แต่ไม่มีการยกเลิกในทะเบียน",
    hint: "ไฟล์ก่อนมีแต่ไฟล์นี้ไม่มี เช่น เสียชีวิต ลาออก หรือสมาคมตัดออก",
    tone: "text-amber-700",
  },
];

const thaiDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("th-TH", { timeZone: "UTC", day: "numeric", month: "short", year: "2-digit" }) : "—";

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function CoverageReconcile({ snapshotId }: { snapshotId: string | null }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Result | null>(null);

  useEffect(() => {
    if (!open) return;
    setData(null);
    const q = snapshotId ? `?snapshot=${snapshotId}` : "";
    fetch(`/api/coverage/reconcile${q}`)
      .then((r) => r.json())
      .then(setData);
  }, [open, snapshotId]);

  const label = (i: ReconcileItem) =>
    `${ENROLLMENT_PRODUCTS[i.product as EnrollmentProduct]}${i.count && i.count > 1 ? ` ${i.count} ราย` : ""}`;

  const exportCsv = () => {
    if (!data) return;
    const head = ["ประเภท", "เลขสมาชิก", "ชื่อ-สกุล", "หน่วยงาน", "รายการ", "จำนวน", "วันที่ในทะเบียน"];
    const lines = data.items.map((i) =>
      [KINDS.find((k) => k.kind === i.kind)?.title, i.memberNumber, i.memberName, i.unitName,
        ENROLLMENT_PRODUCTS[i.product as EnrollmentProduct], i.count ?? 1, i.applicationDate?.slice(0, 10)]
        .map(csvCell)
        .join(",")
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + [head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `เทียบไฟล์ปีกับทะเบียน_${data.snapshot?.label ?? ""}.csv`;
    a.click();
  };

  return (
    <section className="bg-white rounded-lg shadow">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 rounded-lg"
      >
        <span className={`text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        <span className="font-medium">เทียบไฟล์ปีกับทะเบียนการสมัคร</span>
        <span className="text-xs text-slate-500 hidden sm:inline">ตรวจว่าไฟล์ปีใหม่มีครบตามที่บันทึกการสมัครและยกเลิกไว้</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 text-sm">
          {!data ? (
            <p className="text-slate-500">กำลังเทียบ…</p>
          ) : !data.snapshot ? (
            <p className="text-slate-500">ยังไม่มีไฟล์ปี</p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-xs text-slate-500">
                  ไฟล์ &quot;{data.snapshot.label}&quot; (ณ {thaiDate(data.snapshot.date)}) เทียบกับการสมัครและยกเลิกในทะเบียน
                  {data.previous
                    ? ` หลังไฟล์ก่อน "${data.previous.label}" (ณ ${thaiDate(data.previous.date)})`
                    : " ทั้งหมดก่อนวันที่ของไฟล์"}{" "}
                  · ตรวจ {data.eventsChecked.toLocaleString("th-TH")} รายการ ไม่นับที่ไม่อนุมัติ
                  {!data.previous && " · ยังไม่มีไฟล์ก่อนหน้าให้เทียบ จึงตรวจได้เฉพาะสองหัวข้อแรก"}
                </p>
                <button
                  type="button"
                  disabled={data.items.length === 0}
                  onClick={exportCsv}
                  className="px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-40"
                >
                  ส่งออก CSV
                </button>
              </div>
              {KINDS.filter((k) => data.previous || k.kind === "missingFromFile" || k.kind === "stillInFile").map((k) => {
                const list = data.items.filter((i) => i.kind === k.kind);
                return (
                  <div key={k.kind}>
                    <p className={`font-medium ${list.length ? k.tone : "text-slate-700"}`}>
                      {k.title} · {list.length.toLocaleString("th-TH")} รายการ
                    </p>
                    <p className="text-xs text-slate-500">{k.hint}</p>
                    {list.length > 0 && (
                      <table className="w-full mt-1 table-fixed">
                        <colgroup>
                          <col className="w-24" />
                          <col className="w-52" />
                          <col className="w-56" />
                          <col />
                          <col className="w-40" />
                        </colgroup>
                        <tbody>
                          {list.slice(0, 200).map((i) => (
                            <tr key={`${i.memberNumber}-${i.product}`} className="border-t border-slate-100">
                              <td className="num w-24 py-1">{i.memberNumber}</td>
                              <td className="truncate">{i.memberName ?? "—"}</td>
                              <td className="text-slate-500 truncate">{i.unitName ?? ""}</td>
                              <td>{label(i)}</td>
                              <td className="text-xs text-slate-500 text-right">
                                {i.applicationDate && `ในทะเบียน ${thaiDate(i.applicationDate)}`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {list.length > 200 && <p className="text-xs text-slate-500">แสดง 200 รายการแรก ดูทั้งหมดใน CSV</p>}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </section>
  );
}
