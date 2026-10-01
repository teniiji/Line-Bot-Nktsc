import { ExpenseSummary } from "@/lib/types";
import { formatAmount } from "@/lib/format";

interface SummaryCardsProps {
  summary: ExpenseSummary;
}

export default function SummaryCards({ summary }: SummaryCardsProps) {
  const today = summary.today;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Today first: what came in since the office opened is the figure
          staff check through the day, and the only one here that moves
          between one look and the next. */}
      <div className="bg-white rounded-lg shadow p-4">
        <p className="text-sm text-slate-500">
          วันนี้
          {today && <span className="num text-slate-400"> · {today.count.toLocaleString("th-TH")} รายการ</span>}
        </p>
        <p className="text-2xl font-semibold">{formatAmount(today?.total ?? 0)}</p>
        {today && today.byCategory.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
            {today.byCategory.slice(0, 4).map((c) => (
              <li key={c.category} className="flex justify-between gap-2">
                <span className="truncate">
                  {c.category} <span className="text-slate-400">({c.count})</span>
                </span>
                <span className="num whitespace-nowrap">{formatAmount(c.total)}</span>
              </li>
            ))}
            {today.byCategory.length > 4 && (
              <li className="text-slate-400">และอีก {today.byCategory.length - 4} หมวด</li>
            )}
          </ul>
        )}
      </div>
      <div className="bg-white rounded-lg shadow p-4">
        <p className="text-sm text-slate-500">เดือนนี้</p>
        <p className="text-2xl font-semibold">{formatAmount(summary.thisMonth)}</p>
      </div>
      <div className="bg-white rounded-lg shadow p-4">
        <p className="text-sm text-slate-500">ยอดรวมทั้งหมด</p>
        <p className="text-2xl font-semibold">{formatAmount(summary.total)}</p>
      </div>
      <div className="bg-white rounded-lg shadow p-4">
        <p className="text-sm text-slate-500">หมวดที่มียอดสูงสุด</p>
        <p className="text-2xl font-semibold">{summary.topCategory ?? "—"}</p>
      </div>
    </div>
  );
}
