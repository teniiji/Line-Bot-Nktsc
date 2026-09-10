"use client";

import { useEffect, useState } from "react";
import { CATEGORIES } from "@/lib/categories";
import { formatAmount, formatStatementDate, formatStatementTime } from "@/lib/format";
import { CHANNEL_LABELS } from "@/lib/statementLines";
import { Expense } from "@/lib/types";

// What the member-deposits route knows about a member number: who they are,
// and which of their payments the bank has recorded that nobody has filed yet.
interface MemberDeposit {
  id: string;
  postedAt: string | null;
  amount: number;
  description: string;
  branch: string;
  channel: string;
  senderAccount: string | null;
}

interface MemberLookup {
  memberName: string | null;
  unitName: string | null;
  inRoster: boolean;
  lines: MemberDeposit[];
}

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
  // Used instead of onSave when a bank line was chosen: the route reads the
  // amount and the date off the stored line, so neither is sent from here.
  onRecordFromLine: (lineId: string, data: ExpenseFormData) => Promise<void>;
  onCancelEdit: () => void;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function ExpenseForm({
  editingExpense,
  onSave,
  onRecordFromLine,
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
  // What the member number turned out to mean, and the bank lines it can be
  // filled in from. Null until a number has been looked up.
  const [lookup, setLookup] = useState<MemberLookup | null>(null);
  const [looking, setLooking] = useState(false);
  // The bank line this record is being made from, when one was chosen. The
  // amount and the date then come off the statement rather than out of the
  // form — see app/api/statement-lines/[id]/record.
  const [fromLine, setFromLine] = useState<MemberDeposit | null>(null);

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
    setLookup(null);
    setFromLine(null);
  }, [editingExpense]);

  // Looking a member up is what the number is for. Debounced rather than done
  // on every keystroke, and only once the number is long enough to mean
  // something — a lookup of "2" would fetch a stranger's payments and put
  // them on screen under whatever the member is about to finish typing.
  useEffect(() => {
    const typed = memberNumber.trim();
    if (typed.length < 4) {
      setLookup(null);
      setFromLine(null);
      return;
    }
    let cancelled = false;
    setLooking(true);
    const timer = setTimeout(() => {
      fetch(`/api/member-deposits?memberNumber=${encodeURIComponent(typed)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((body: MemberLookup | null) => {
          if (cancelled) return;
          setLookup(body);
          // A line chosen for a different member is not this member's.
          setFromLine(null);
          // The roster's spelling of the name, not the operator's — but only
          // into an empty box, so a name typed deliberately is never
          // overwritten while somebody is still working.
          if (body?.memberName) {
            setMemberFullName((current) => current.trim() || body.memberName!);
          }
        })
        .catch(() => {
          if (!cancelled) setLookup(null);
        })
        .finally(() => {
          if (!cancelled) setLooking(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [memberNumber]);

  // Filling the form from a bank line, so what is recorded is what the bank
  // says arrived rather than what somebody remembered at the counter.
  const chooseLine = (line: MemberDeposit) => {
    setFromLine(line);
    setAmount(String(line.amount));
    if (line.postedAt) setDate(line.postedAt.slice(0, 10));
  };

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
    const data = {
      amount: parsedAmount,
      category,
      description,
      date,
      memberFullName,
      memberNumber,
    };
    try {
      if (fromLine && !editingExpense) {
        await onRecordFromLine(fromLine.id, data);
      } else {
        await onSave(data);
      }
      if (!editingExpense) {
        setAmount("");
        setDescription("");
        setMemberFullName("");
        setMemberNumber("");
        setFromLine(null);
        setLookup(null);
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
            {looking && <span className="text-xs text-slate-400"> · กำลังค้นหา…</span>}
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

      {/* What the member number turned out to mean, and their money the bank
          has already recorded. Filling the amount and the date from a bank
          line rather than from what somebody was told at the counter is the
          whole point: those two numbers then come off the statement. */}
      {!editingExpense && lookup && (
        <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <p className="text-slate-700">
            {lookup.inRoster ? (
              <>
                <span className="text-green-700">✓ พบในทะเบียน</span> — {lookup.memberName}
                {lookup.unitName && <span className="text-slate-500"> · {lookup.unitName}</span>}
              </>
            ) : (
              <span className="text-amber-700">
                ⚠️ ไม่พบเลขสมาชิกนี้ในทะเบียน — บันทึกได้ แต่จะขึ้นเป็นรายการรอยืนยันตัวตน
              </span>
            )}
          </p>

          {lookup.lines.length > 0 ? (
            <div className="mt-2">
              <p className="text-xs text-slate-600 mb-1">
                เงินเข้าของสมาชิกรายนี้ที่ยังไม่ได้บันทึก — กดเลือกเพื่อดึงยอดและวันที่จากสเตทเมนต์
              </p>
              <ul className="space-y-1">
                {lookup.lines.map((line) => (
                  <li key={line.id}>
                    <button
                      type="button"
                      onClick={() => chooseLine(line)}
                      className={`w-full text-left rounded border px-2 py-1.5 hover:bg-white ${
                        fromLine?.id === line.id
                          ? "border-slate-900 bg-white"
                          : "border-slate-200"
                      }`}
                    >
                      <span className="num font-medium">{formatAmount(line.amount)}</span>
                      <span className="text-slate-500">
                        {" · "}
                        {formatStatementDate(line.postedAt)}
                        {formatStatementTime(line.postedAt)
                          ? ` ${formatStatementTime(line.postedAt)}`
                          : ""}
                        {" · "}
                        {line.branch}
                        {" · "}
                        {CHANNEL_LABELS[line.channel] ?? line.channel}
                      </span>
                      {fromLine?.id === line.id && (
                        <span className="text-xs text-green-700"> ✓ เลือกแล้ว</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {fromLine && (
                <p className="text-xs text-slate-600 mt-1">
                  ยอดและวันที่จะอ่านจากบรรทัดในสเตทเมนต์ ไม่ใช่จากช่องด้านบน —
                  และบรรทัดนี้จะผูกกับรายการที่บันทึก บันทึกซ้ำอีกรอบไม่ได้{" "}
                  <button
                    type="button"
                    onClick={() => setFromLine(null)}
                    className="underline"
                  >
                    ยกเลิกการเลือก
                  </button>
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-500 mt-1">
              ไม่พบเงินเข้าที่ยังไม่ได้บันทึกของสมาชิกรายนี้ — กรอกยอดและวันที่เองได้ตามปกติ
              (ระบบหาจากเลขบัญชีที่ผูกกับสมาชิกไว้ ถ้ายังไม่เคยผูกก็จะไม่เจอ)
            </p>
          )}
        </div>
      )}

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
