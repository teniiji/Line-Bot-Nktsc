"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { formatAmount } from "@/lib/format";

const compactBaht = (value: number) =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toLocaleString("th-TH", { maximumFractionDigits: 1 })}M`
    : value >= 1_000
      ? `${(value / 1_000).toLocaleString("th-TH", { maximumFractionDigits: 0 })}K`
      : String(value);

interface TrendChartProps {
  data: { month: string; total: number }[];
}

export default function TrendChart({ data }: TrendChartProps) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h2 className="font-semibold mb-2">แนวโน้มรายเดือน</h2>
      {data.length === 0 ? (
        <p className="text-slate-500 text-sm py-10 text-center">ไม่มีข้อมูล</p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            {/* Millions do not fit the axis written out — "000000" was all
                that showed of ฿20,000,000. */}
            <YAxis width={56} tickFormatter={compactBaht} />
            <Tooltip formatter={(value: number) => formatAmount(value)} />
            <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
