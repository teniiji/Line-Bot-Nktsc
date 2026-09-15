"use client";

import { useEffect, useRef, useState } from "react";
import { STAFF_CATEGORIES, categoryNeedsDetail, staffCategoryProblem } from "@/lib/categories";
import { formatAmount, formatStatementDate, formatStatementTime } from "@/lib/format";
import { CHANNEL_LABELS } from "@/lib/statementLines";
import { cooperativeToday } from "@/lib/cooperativeClock";
import DateField from "@/components/DateField";
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

// The form opens on today at the cooperative, not today on this device — a
// staff member filing a payment at half past midnight is filing it for that
// day, not the one before. See lib/cooperativeClock.ts.
const todayIso = () => cooperativeToday();

export default function ExpenseForm({
  editingExpense,
  onSave,
  onRecordFromLine,
  onCancelEdit,
}: ExpenseFormProps) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>(STAFF_CATEGORIES[0]);
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
  // The form sits under the table, so pressing แก้ไข on a row filled it in
  // somewhere off the bottom of the screen and nothing moved where the eye
  // was — which reads as a button that does not work, and was reported as
  // one. The click now takes you to the form it filled.
  const formRef = useRef<HTMLFormElement>(null);

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
      setCategory(STAFF_CATEGORIES[0]);
      setDescription("");
      setDate(todayIso());
      setMemberFullName("");
      setMemberNumber("");
    }
    setLookup(null);
    setFromLine(null);
    // Only when an edit starts. Scrolling on every render would drag the page
    // about while somebody is typing a new entry.
    if (editingExpense) {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
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
    // อื่นๆ says nothing on its own, so the detail field stops being optional
    // the moment it is chosen. Checked here as well as in the route so the
    // answer is asked for before the form is sent.
    const categoryProblem = staffCategoryProblem(category, description);
    if (categoryProblem) {
      setError(categoryProblem);
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
      ref={formRef}
      onSubmit={handleSubmit}
      className={`bg-white rounded-lg shadow p-4 space-y-3 ${
        // Said in colour as well as in words: the same form does two jobs,
        // and editing somebody's ฿10,000 while believing you are adding a new
        // record is the mistake worth designing against.
        editingExpense ? "ring-2 ring-amber-400" : ""
      }`}
    >
      <h2 className="font-semibold text-lg">
        {editingExpense ? "แก้ไขรายการ" : "บันทึกรายการ (โดยเจ้าหน้าที่)"}
      </h2>
      {editingExpense && (
        <p className="text-sm text-amber-800 bg-amber-50 rounded px-3 py-2">
          กำลังแก้ไขรายการของ{" "}
          <strong>{editingExpense.memberFullName ?? "สมาชิก"}</strong>
          {editingExpense.memberNumber ? ` (${editingExpense.memberNumber})` : ""} ·{" "}
          {formatStatementDate(editingExpense.date)} · {formatAmount(editingExpense.amount)} —
          กด "ยกเลิก" ด้านล่างถ้าไม่ได้ตั้งใจแก้
        </p>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">
          {error}
        </p>
      )}

      {/* The member number leads, because it is now the field that does the
          work: typing it finds who they are and what they have paid in, and
          the amount and the date below can be filled from what it turns up
          rather than from what somebody was told. Filling in the amount first
          is the older habit, and the wrong order for this form. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        <div>
          <label className="block text-sm text-slate-600 mb-1">หมวดหมู่</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full border border-slate-300 rounded px-3 py-2"
          >
            {STAFF_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {categoryNeedsDetail(category) && (
            <p className="text-xs text-amber-800 mt-1">
              เขียนในช่อง "ระบุว่าทำอะไร" ด้านล่างด้วยว่าเป็นค่าอะไร
            </p>
          )}
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
        {/* The same field either way — what changes is whether the
            transaction can be read back without it. Under อื่นๆ it is the
            only thing that says what the money was. */}
        <label className="block text-sm text-slate-600 mb-1">
          {categoryNeedsDetail(category) ? (
            <>
              ระบุว่าทำอะไร <span className="text-amber-700">(ต้องกรอก)</span>
            </>
          ) : (
            "รายละเอียด (ไม่บังคับ)"
          )}
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`w-full border rounded px-3 py-2 ${
            categoryNeedsDetail(category) ? "border-amber-400" : "border-slate-300"
          }`}
          placeholder={
            categoryNeedsDetail(category)
              ? "เช่น ค่าปรับผิดนัดชำระ, ค่าธรรมเนียมออกเอกสาร"
              : "เช่น ชำระผ่านเคาน์เตอร์สำนักงาน"
          }
        />
      </div>

      <DateField
        label="วันที่"
        value={date}
        onChange={setDate}
        className="w-full border border-slate-300 rounded px-3 py-2"
        required
      />

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
