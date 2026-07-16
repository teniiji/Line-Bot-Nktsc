"use client";

import { CATEGORIES } from "@/lib/categories";

export interface Filters {
  category: string;
  from: string;
  to: string;
  // "" = ทั้งหมด, "false" = รอยืนยันตัวตน (คิวตรวจสอบ), "true" = ยืนยันแล้ว
  verified: string;
}

interface ExpenseFiltersProps {
  filters: Filters;
  onChange: (filters: Filters) => void;
}

const toIso = (d: Date) => d.toISOString().slice(0, 10);

const DATE_PRESETS: { label: string; range: () => { from: string; to: string } }[] = [
  {
    label: "เดือนนี้",
    range: () => {
      const now = new Date();
      return {
        from: toIso(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: toIso(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      };
    },
  },
  {
    label: "เดือนที่แล้ว",
    range: () => {
      const now = new Date();
      return {
        from: toIso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: toIso(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    },
  },
  {
    label: "7 วันล่าสุด",
    range: () => {
      const now = new Date();
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      return { from: toIso(from), to: toIso(now) };
    },
  },
];

export default function ExpenseFilters({
  filters,
  onChange,
}: ExpenseFiltersProps) {
  const hasActiveFilters =
    filters.category !== "All" || filters.from || filters.to || filters.verified;

  return (
    <div className="bg-white rounded-lg shadow p-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        {DATE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onChange({ ...filters, ...preset.range() })}
            className="text-xs px-3 py-1.5 border border-slate-300 rounded-full hover:bg-slate-50"
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() =>
            onChange({
              ...filters,
              verified: filters.verified === "false" ? "" : "false",
            })
          }
          className={`text-xs px-3 py-1.5 border rounded-full ${
            filters.verified === "false"
              ? "border-amber-500 bg-amber-50 text-amber-700 font-medium"
              : "border-slate-300 hover:bg-slate-50"
          }`}
        >
          ⚠️ คิวตรวจสอบ (รอยืนยันตัวตน)
        </button>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="w-full sm:w-auto">
          <label className="block text-sm text-slate-600 mb-1">หมวดหมู่</label>
          <select
            value={filters.category}
            onChange={(e) => onChange({ ...filters, category: e.target.value })}
            className="w-full sm:w-auto border border-slate-300 rounded px-3 py-2"
          >
            <option value="All">ทั้งหมด</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="w-full sm:w-auto">
          <label className="block text-sm text-slate-600 mb-1">สถานะยืนยันตัวตน</label>
          <select
            value={filters.verified}
            onChange={(e) => onChange({ ...filters, verified: e.target.value })}
            className="w-full sm:w-auto border border-slate-300 rounded px-3 py-2"
          >
            <option value="">ทั้งหมด</option>
            <option value="false">รอยืนยัน</option>
            <option value="true">ยืนยันแล้ว</option>
          </select>
        </div>
        <div className="w-full sm:w-auto">
          <label className="block text-sm text-slate-600 mb-1">ตั้งแต่วันที่</label>
          <input
            type="date"
            value={filters.from}
            onChange={(e) => onChange({ ...filters, from: e.target.value })}
            className="w-full sm:w-auto border border-slate-300 rounded px-3 py-2"
          />
        </div>
        <div className="w-full sm:w-auto">
          <label className="block text-sm text-slate-600 mb-1">ถึงวันที่</label>
          <input
            type="date"
            value={filters.to}
            onChange={(e) => onChange({ ...filters, to: e.target.value })}
            className="w-full sm:w-auto border border-slate-300 rounded px-3 py-2"
          />
        </div>
        {hasActiveFilters && (
          <button
            onClick={() =>
              onChange({ category: "All", from: "", to: "", verified: "" })
            }
            className="text-sm text-slate-600 underline px-2 py-2"
          >
            ล้างตัวกรอง
          </button>
        )}
      </div>
    </div>
  );
}
