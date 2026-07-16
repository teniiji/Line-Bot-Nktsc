import { ExpenseSummary } from "@/lib/types";
import { formatAmount } from "@/lib/format";

interface SummaryCardsProps {
  summary: ExpenseSummary;
}

export default function SummaryCards({ summary }: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="bg-white rounded-lg shadow p-4">
        <p className="text-sm text-slate-500">ยอดรวมทั้งหมด</p>
        <p className="text-2xl font-semibold">{formatAmount(summary.total)}</p>
      </div>
      <div className="bg-white rounded-lg shadow p-4">
        <p className="text-sm text-slate-500">เดือนนี้</p>
        <p className="text-2xl font-semibold">{formatAmount(summary.thisMonth)}</p>
      </div>
      <div className="bg-white rounded-lg shadow p-4">
        <p className="text-sm text-slate-500">หมวดที่มียอดสูงสุด</p>
        <p className="text-2xl font-semibold">{summary.topCategory ?? "—"}</p>
      </div>
    </div>
  );
}
