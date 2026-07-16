"use client";

import { useEffect, useState } from "react";
import { CATEGORIES } from "@/lib/categories";
import { Expense } from "@/lib/types";

export interface ExpenseFormData {
  amount: number;
  category: string;
  description: string;
  date: string;
  memberFullName: string;
  memberNumber: string;
}

interface ExpenseFormProps {
  editingExpense: Expense | null;
  onSave: (data: ExpenseFormData) => Promise<void>;
  onCancelEdit: () => void;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function ExpenseForm({
  editingExpense,
  onSave,
  onCancelEdit,
}: ExpenseFormProps) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayIso());
  const [memberFullName, setMemberFullName] = useState("");
  const [memberNumber, setMemberNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (editingExpense) {
      setAmount(String(editingExpense.amount));
      setCategory(editingExpense.category);
      setDescription(editingExpense.description ?? "");
      setDate(editingExpense.date.slice(0, 10));
      setMemberFullName(editingExpense.memberFullName ?? "");
      setMemberNumber(editingExpense.memberNumber ?? "");
    } else {
      setAmount("");
      setCategory(CATEGORIES[0]);
      setDescription("");
      setDate(todayIso());
      setMemberFullName("");
      setMemberNumber("");
    }
  }, [editingExpense]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("กรุณากรอกจำนวนเงินมากกว่า 0");
      return;
    }
    if (!date) {
      setError("กรุณาเลือกวันที่");
      return;
    }

    setSubmitting(true);
    try {
      await onSave({
        amount: parsedAmount,
        category,
        description,
        date,
        memberFullName,
        memberNumber,
      });
      if (!editingExpense) {
        setAmount("");
        setDescription("");
        setMemberFullName("");
        setMemberNumber("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-lg shadow p-4 space-y-3"
    >
      <h2 className="font-semibold text-lg">
        {editingExpense ? "แก้ไขรายการ" : "บันทึกรายการ (โดยเจ้าหน้าที่)"}
      </h2>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-slate-600 mb-1">จำนวนเงิน (บาท)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2"
            placeholder="0.00"
            required
          />
        </div>
        <div>
          <label className="block text-sm text-slate-600 mb-1">หมวดหมู่</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-slate-600 mb-1">
            ชื่อ-นามสกุลสมาชิก (ถ้ามี)
          </label>
          <input
            type="text"
            value={memberFullName}
            onChange={(e) => setMemberFullName(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2"
            placeholder="เช่น สมชาย ใจดี"
          />
        </div>
        <div>
          <label className="block text-sm text-slate-600 mb-1">
            เลขสมาชิก (ถ้ามี)
          </label>
          <input
            type="text"
            value={memberNumber}
            onChange={(e) => setMemberNumber(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2"
            placeholder="เช่น 012345"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm text-slate-600 mb-1">
          รายละเอียด (ไม่บังคับ)
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full border border-slate-300 rounded px-3 py-2"
          placeholder="เช่น ชำระผ่านเคาน์เตอร์สำนักงาน"
        />
      </div>

      <div>
        <label className="block text-sm text-slate-600 mb-1">วันที่</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full border border-slate-300 rounded px-3 py-2"
          required
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="bg-slate-900 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {editingExpense ? "บันทึกการแก้ไข" : "บันทึกรายการ"}
        </button>
        {editingExpense && (
          <button
            type="button"
            onClick={onCancelEdit}
            className="border border-slate-300 rounded px-4 py-2 text-sm font-medium"
          >
            ยกเลิก
          </button>
        )}
      </div>
    </form>
  );
}
