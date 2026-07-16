"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { CATEGORY_COLORS, Category } from "@/lib/categories";
import { formatAmount } from "@/lib/format";

interface CategoryChartProps {
  data: { category: string; total: number }[];
}

export default function CategoryChart({ data: byCategory }: CategoryChartProps) {
  const data = byCategory.map((d) => ({ name: d.category, value: d.total }));

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h2 className="font-semibold mb-2">ยอดแยกตามหมวดหมู่</h2>
      {data.length === 0 ? (
        <p className="text-slate-500 text-sm py-10 text-center">ไม่มีข้อมูล</p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={90}
              label={(entry) => entry.name}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={CATEGORY_COLORS[entry.name as Category] ?? "#94a3b8"}
                />
              ))}
            </Pie>
            <Tooltip formatter={(value: number) => formatAmount(value)} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
