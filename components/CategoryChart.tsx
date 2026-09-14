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
        /* The category names used to be written outside the pie on leader
           lines. Eleven Thai category names around a circle need more width
           than this card has, so they were pushed out past its edges and the
           pie was squeezed to nothing between them — what loaded was a ring of
           floating labels with the chart itself below the fold, which reads as
           a broken graph rather than a cramped one. The legend already names
           every category, so the labels come off and the room goes back to the
           pie. */
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="42%" outerRadius={95}>
              {data.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={CATEGORY_COLORS[entry.name as Category] ?? "#94a3b8"}
                />
              ))}
            </Pie>
            <Tooltip formatter={(value: number) => formatAmount(value)} />
            <Legend
              verticalAlign="bottom"
              height={64}
              wrapperStyle={{ fontSize: 12, lineHeight: "18px" }}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
