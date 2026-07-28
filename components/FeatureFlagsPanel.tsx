"use client";

import { useEffect, useState } from "react";
import { FeatureFlagEntry } from "@/lib/types";

export default function FeatureFlagsPanel() {
  const [flags, setFlags] = useState<FeatureFlagEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchFlags = async () => {
    setLoading(true);
    const res = await fetch("/api/feature-flags");
    const data = await res.json();
    setFlags(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchFlags();
  }, []);

  const toggle = async (key: string, next: boolean) => {
    setSavingKey(key);
    setError(null);
    const previous = flags;
    setFlags((prev) => prev.map((f) => (f.key === key ? { ...f, enabled: next } : f)));
    try {
      const res = await fetch("/api/feature-flags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, enabled: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "บันทึกไม่สำเร็จ");
        setFlags(previous);
        return;
      }
    } finally {
      setSavingKey(null);
    }
  };

  const globalFlags = flags.filter((f) => !f.key.startsWith("dept_notify_"));
  const departmentFlags = flags.filter((f) => f.key.startsWith("dept_notify_"));

  const renderRow = (flag: FeatureFlagEntry) => (
    <li key={flag.id} className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-sm">{flag.label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={flag.enabled}
        aria-label={flag.label}
        disabled={savingKey === flag.key}
        onClick={() => toggle(flag.key, !flag.enabled)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          flag.enabled ? "bg-green-600" : "bg-slate-300"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            flag.enabled ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </li>
  );

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="font-semibold">ตั้งค่าระบบ</h2>
        <p className="text-xs text-slate-500 mt-1">
          เปิด/ปิดฟังก์ชันของบอทเองได้ทันที ไม่ต้องรอ deploy (มีผลภายในประมาณ 15 วินาที) —
          ปิดฟังก์ชันหลักไว้ บอทจะขอโทษสมาชิกตรงๆ ว่าปิดใช้งานชั่วคราว แทนที่จะทำงานครึ่งๆ กลางๆ
          ส่วนสวิตช์ "ถามคำถาม..." แต่ละข้อ ปิดไว้แค่ข้ามคำถามนั้นไปเฉยๆ (บันทึกธุรกรรมได้แม้ข้อมูลข้อนั้นยังว่างอยู่)
          ไม่มีข้อความแจ้งสมาชิก
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2 mx-4 mt-3">{error}</p>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
      ) : (
        <>
          <h3 className="px-4 pt-3 pb-1 text-xs font-medium text-slate-500 uppercase tracking-wide">
            ฟังก์ชันหลัก
          </h3>
          <ul className="divide-y divide-slate-100 border-b border-slate-100">
            {globalFlags.map(renderRow)}
          </ul>

          <h3 className="px-4 pt-3 pb-1 text-xs font-medium text-slate-500 uppercase tracking-wide">
            การแจ้งเตือนรายแผนก
          </h3>
          <ul className="divide-y divide-slate-100">{departmentFlags.map(renderRow)}</ul>
        </>
      )}
    </div>
  );
}
