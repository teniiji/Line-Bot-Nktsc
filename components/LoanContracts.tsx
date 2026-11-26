"use client";

import { LOAN_TYPES, type ShareDebtContract } from "@/lib/shareDebt";

// A member's loans, contract by contract, as the share-and-debt report
// listed them. With onToggle, each row can be ticked (คำนวณก่อนกู้: the
// contracts the new loan pays off).

const baht = (x: number | null) => (x == null ? "—" : x.toLocaleString("th-TH", { maximumFractionDigits: 2 }));

export default function LoanContracts({
  contracts,
  total,
  checked,
  onToggle,
}: {
  contracts: ShareDebtContract[];
  // The report's รวม for the member; anything above the contracts is shown
  // as หนี้อื่น (the report counts loans it has no column for).
  total: number | null;
  checked?: Set<number>;
  onToggle?: (index: number) => void;
}) {
  const sum = Math.round(contracts.reduce((s, c) => s + c.balance, 0) * 100) / 100;
  const other = total != null ? Math.round((total - sum) * 100) / 100 : 0;
  if (contracts.length === 0 && !other) return <p className="text-sm text-slate-400">ไม่มีหนี้เงินกู้</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-slate-500 text-left">
        <tr>
          {onToggle && <th className="w-16">หักกลบ</th>}
          <th className="py-1">ประเภท</th>
          <th>เลขที่สัญญา</th>
          <th className="text-right">งวด</th>
          <th className="text-right">ชำระ/งวด</th>
          <th className="text-right">คงเหลือ</th>
        </tr>
      </thead>
      <tbody>
        {contracts.map((c, i) => (
          <tr key={i} className="border-t border-slate-100">
            {onToggle && (
              <td>
                <input type="checkbox" checked={checked?.has(i) ?? false} onChange={() => onToggle(i)} aria-label={`หักกลบสัญญา ${c.contractNo ?? i + 1}`} />
              </td>
            )}
            <td className="py-1">เงินกู้{LOAN_TYPES[c.type]}</td>
            <td className="num">{c.contractNo ?? "—"}</td>
            <td className="text-right num">{c.installment ?? "—"}</td>
            <td className="text-right num">{baht(c.payment)}</td>
            <td className={`text-right num ${c.balance < 0 ? "text-red-600" : ""}`}>{baht(c.balance)}</td>
          </tr>
        ))}
        {Math.abs(other) >= 0.01 && (
          <tr className="border-t border-slate-100 text-slate-500">
            {onToggle && <td />}
            <td className="py-1" colSpan={4}>
              หนี้อื่นที่รวมในยอดรวมของรายงาน (ไม่มีรายสัญญา)
            </td>
            <td className="text-right num">{baht(other)}</td>
          </tr>
        )}
        <tr className="border-t-2 border-slate-300 font-medium">
          {onToggle && <td />}
          <td className="py-1" colSpan={4}>
            หนี้รวม
          </td>
          <td className="text-right num">{baht(total ?? sum)}</td>
        </tr>
      </tbody>
    </table>
  );
}
