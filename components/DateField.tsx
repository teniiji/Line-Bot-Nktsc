"use client";

import { formatThaiDay } from "@/lib/format";

// A date box with its Buddhist-era reading underneath.
//
// The browser draws the box itself and draws it Gregorian — see formatThaiDay
// for why that cannot be changed from here. So the date staff actually read is
// printed under it, in the same form as every other date in the dashboard.
export default function DateField({
  value,
  onChange,
  className = "",
  label,
  required = false,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  // Rendered above the box when given; the caller owns the layout otherwise.
  label?: string;
  required?: boolean;
}) {
  const thai = formatThaiDay(value);
  return (
    <div className={label ? "w-full sm:w-auto" : "inline-block"}>
      {label && <label className="block text-sm text-slate-600 mb-1">{label}</label>}
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        required={required}
      />
      {/* Always present once a day is set, so the boxes do not jump as the
          range changes. */}
      {thai && <span className="block text-xs text-slate-500 mt-0.5 num">{thai}</span>}
    </div>
  );
}
