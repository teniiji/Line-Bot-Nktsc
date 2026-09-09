"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { formatAmount, formatStatementDate, formatStatementTime } from "@/lib/format";
import { CATEGORIES } from "@/lib/categories";
import { accountCaveat, canBindAccount } from "@/lib/depositRecord";
import { CHANNEL_LABELS } from "@/lib/statementLines";
import {
  DailyDepositRow,
  DailyOtherLineRow,
  DailyReconcileResult,
  DailySlipRow,
} from "@/lib/types";

const todayISO = () => new Date().toISOString().slice(0, 10);

const shiftDay = (date: string, days: number) => {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
};

const Money = ({ value, className = "" }: { value: number; className?: string }) => (
  <span className={`num whitespace-nowrap ${className}`}>{formatAmount(value)}</span>
);

const Clock = ({ iso }: { iso: string | null }) => {
  const time = formatStatementTime(iso);
  return <span className="num text-slate-500">{time || formatStatementDate(iso)}</span>;
};

// Who a payment came from, as far as anything knows. The account number is
// what staff match against the bank; the member number is only there when the
// directory recognised it.
const Payer = ({ deposit }: { deposit: DailyDepositRow }) => (
  <span>
    {deposit.memberNumber ? (
      <span className="num">{deposit.memberNumber}</span>
    ) : (
      <span className="text-slate-400">ไม่รู้ว่าใคร</span>
    )}
    {deposit.senderAccount && (
      <span className="font-mono text-xs text-slate-400"> · {deposit.senderAccount}</span>
    )}
  </span>
);

// The slip behind a transaction, or why there is no image to open. Shared by
// every table that shows one, so "no slip" and "never had a slip" keep saying
// two different things wherever they appear.
const SlipLink = ({ slip }: { slip: DailySlipRow }) =>
  slip.slipImageUrl ? (
    <a
      href={slip.slipImageUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="text-slate-900 hover:underline"
    >
      ดูสลิป
    </a>
  ) : slip.statementLineId ? (
    // Not a missing file: this one never had a slip, staff recorded it from
    // the statement. Saying so stops it reading as an error.
    <span className="text-xs text-slate-500">เจ้าหน้าที่บันทึกเอง</span>
  ) : (
    <span className="text-slate-400">—</span>
  );

// Why this pair was made, said plainly enough that a person can decide
// whether to trust it. The five are genuinely different levels of evidence,
// so they get five different labels rather than a tick.
const MatchBasis = ({
  basis,
  minutesApart,
}: {
  basis: DailyReconcileResult["matched"][number]["basis"];
  minutesApart: number | null;
}) => {
  if (basis === "staff") {
    return (
      <span
        className="text-green-700"
        title="เจ้าหน้าที่บันทึกรายการนี้จากเงินเข้าก้อนนี้โดยตรง ไม่ได้เดาจากยอดหรือเวลา"
      >
        เจ้าหน้าที่บันทึกเอง
      </span>
    );
  }
  if (basis === "account") {
    return (
      <span className="text-green-700" title="เลขบัญชีผู้โอนตรงกับทะเบียนเลขบัญชีของสมาชิกคนนี้">
        เลขบัญชีตรง
      </span>
    );
  }
  if (basis === "slipAccount") {
    return (
      <span
        className="text-green-700"
        title="เลขบัญชีที่พิมพ์อยู่บนสลิป (เท่าที่ไม่ถูกปิดบัง) ตรงกับเลขบัญชีผู้โอนใน statement — ไม่ต้องพึ่งทะเบียนเลขบัญชี"
      >
        บัญชีในสลิปตรง
      </span>
    );
  }
  if (basis === "time") {
    return (
      <span
        className="text-sky-700"
        title="ยอดตรงและเวลาบนสลิปใกล้กับเวลาที่ธนาคารบันทึก — ยังไม่ยืนยันเลขบัญชี"
      >
        เวลาใกล้กัน
        {minutesApart !== null && <span className="text-slate-400"> ({minutesApart} นาที)</span>}
      </span>
    );
  }
  return (
    <span
      className="text-amber-700"
      title="จับคู่จากยอดเงินอย่างเดียว — ถ้าวันนี้มีคนโอนยอดเท่ากันหลายคน คู่นี้อาจสลับกันได้"
    >
      ยอดตรงเท่านั้น
    </span>
  );
};

export default function DailyReconcilePanel() {
  const [date, setDate] = useState(todayISO);
  const [data, setData] = useState<DailyReconcileResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [showKnown, setShowKnown] = useState(false);
  // Uploading right here rather than sending staff to the round tab: checking
  // one day's money has nothing to do with the month-end round.
  const [account, setAccount] = useState("413");
  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  // Which unclaimed deposit has its form open, and which of the two answers
  // it is being given. Only one at a time — the work is one payment, one
  // phone call.
  const [acting, setActing] = useState<{ id: string; kind: "bind" | "record" } | null>(null);
  const [actMemberNumber, setActMemberNumber] = useState("");
  // Starts unchosen on purpose. Defaulting to the first category would let a
  // distracted click file a ฿90,000 payment as ซื้อหุ้น without anyone having
  // decided that — the category is what routes the payment to a department.
  const [actCategory, setActCategory] = useState<string>("");
  // Only used when the roster does not know the number. Optional on purpose:
  // most numbers are in the roster and the name comes from there, so making
  // it required would tax every recording for the sake of the few.
  const [actMemberName, setActMemberName] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const fetchDay = useCallback(async (day: string) => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/daily-reconcile?date=${day}`);
    const body = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(body.error || "โหลดข้อมูลไม่สำเร็จ");
      setData(null);
      return;
    }
    setData(body);
  }, []);

  useEffect(() => {
    fetchDay(date);
  }, [date, fetchDay]);

  const uploadStatement = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    setError(null);
    setUploadNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("account", account);
      const res = await fetch("/api/statement-lines", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "อ่าน Statement ไม่สำเร็จ");
        return;
      }
      const covers =
        body.from && body.to
          ? ` ครอบคลุม ${formatStatementDate(body.from)} ถึง ${formatStatementDate(body.to)}`
          : "";
      setUploadNotice(`บัญชี ${body.account} ${body.branch}: อ่านได้ ${body.lines} รายการ${covers}`);
      // Reloads the day on screen, which is the one the person came to look at.
      await fetchDay(date);
    } finally {
      setUploading(false);
    }
  };

  const closeForm = () => {
    setActing(null);
    setActMemberNumber("");
    setActMemberName("");
    setActCategory("");
  };

  // "That account is นาง X's" — a fact about an account, so it goes to the
  // directory and holds for every future transfer from it. Deliberately not
  // combined with recording the payment: the same call often answers only one
  // of the two, and pretending otherwise would file a transaction nobody
  // asked for.
  const bindAccount = async (accountNumber: string) => {
    setSaving(true);
    setError(null);
    setActionNotice(null);
    try {
      const res = await fetch("/api/member-bank-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountNumber,
          memberNumber: actMemberNumber.trim(),
          note: "ระบุจากหน้าเงินเข้าประจำวัน",
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "ผูกบัญชีไม่สำเร็จ");
        return;
      }
      setActionNotice(
        `ผูกบัญชี ${body.accountNumber} เข้ากับ ${body.memberNumber} ${body.memberName ?? ""} แล้ว` +
          (body.inRoster ? "" : " — ⚠️ ไม่พบเลขสมาชิกนี้ในทะเบียนสมาชิก ตรวจสอบอีกครั้ง") +
          (body.rounds ? ` · จับคู่รอบเก็บไม่ได้ใหม่ ${body.rounds} รอบ` : "") +
          " · ครั้งต่อไปรู้เองไม่ต้องระบุซ้ำ"
      );
      closeForm();
      await fetchDay(date);
    } finally {
      setSaving(false);
    }
  };

  // "That money was นาง X paying her หักไม่ได้" — a fact about this one
  // payment, so it becomes a transaction. The amount and the date come from
  // the stored bank line inside the route, not from here.
  const recordDeposit = async (depositId: string) => {
    setSaving(true);
    setError(null);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/statement-lines/${depositId}/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberNumber: actMemberNumber.trim(),
          memberName: actMemberName.trim(),
          category: actCategory,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "บันทึกรายการไม่สำเร็จ");
        return;
      }
      setActionNotice(
        `บันทึก ${formatAmount(body.amount)} เป็น "${body.category}" ให้ ` +
          `${body.memberNumber} ${body.memberFullName ?? ""} แล้ว` +
          (body.inRoster ? "" : " — ⚠️ ไม่พบเลขสมาชิกนี้ในทะเบียนสมาชิก ตรวจสอบอีกครั้ง")
      );
      closeForm();
      await fetchDay(date);
    } finally {
      setSaving(false);
    }
  };

  // Money nobody claimed, split by whether anything knows who paid it.
  const unknownPayer = (data?.depositsWithoutSlip ?? []).filter((d) => !d.memberNumber);
  const knownPayer = (data?.depositsWithoutSlip ?? []).filter((d) => d.memberNumber);

  const totals = data?.totals;
  const gap = totals ? Math.round((totals.depositAmount - totals.slipAmount) * 100) / 100 : 0;

  return (
    <section className="bg-white rounded-lg border border-slate-200">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="font-semibold">เงินเข้าประจำวัน (เทียบกับสลิปที่ส่งมาทางไลน์)</h2>
        <p className="text-xs text-slate-500 mt-1">
          เทียบ <strong>เงินที่เข้าบัญชีสหกรณ์วันนั้น</strong> กับ{" "}
          <strong>สลิปที่สมาชิกส่งเข้าบอท</strong> วันเดียวกัน เพื่อจับ 2 อย่าง:
          สลิปที่ไม่มีเงินเข้าจริง และเงินที่เข้ามาโดยไม่มีใครแจ้ง —{" "}
          <strong>อัปโหลด Statement ได้ที่นี่เลย ไม่ต้องสร้างรอบเก็บไม่ได้</strong>{" "}
          (ไฟล์ที่เคยอัปในแท็บ "เทียบ Statement" ก็ใช้ได้ ไม่ต้องอัปซ้ำ)
        </p>
        <p className="text-xs text-amber-700 mt-1">
          ⚠️ ช่อง <strong>"จับคู่จาก"</strong> บอกว่าคู่นั้นเชื่อได้แค่ไหน —
          <strong>เลขบัญชีตรง</strong> กับ <strong>บัญชีในสลิปตรง</strong> แน่นอนเกือบ 100%,
          <strong>เวลาใกล้กัน</strong> ค่อนข้างแน่, ส่วน <strong>ยอดตรงเท่านั้น</strong> คือ
          <strong>เดา</strong> — วันที่มีคนโอนยอดเท่ากันหลายคนอาจสลับคู่กันได้
          ให้ถือว่าเป็นรายการให้ไล่ดู ไม่ใช่คำตอบสุดท้าย
        </p>
        <p className="text-xs text-slate-400 mt-1">
          สลิปที่บอทบันทึก<strong>ตั้งแต่ 7 ก.ย. 69 เป็นต้นไป</strong>จะเก็บเวลาที่โอนและเลขบัญชีผู้โอน
          (เท่าที่สลิปแสดง) ไว้ด้วย — รายการเก่ากว่านั้นยังมีแค่วันที่กับยอดเงิน จึงจับคู่ได้แค่ "ยอดตรงเท่านั้น"
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-100 text-sm">
        <button
          onClick={() => setDate(shiftDay(date, -1))}
          className="px-2 py-1.5 border border-slate-200 rounded-md hover:bg-slate-50"
        >
          ← วันก่อน
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="border border-slate-300 rounded-md px-3 py-1.5"
        />
        <button
          onClick={() => setDate(shiftDay(date, 1))}
          className="px-2 py-1.5 border border-slate-200 rounded-md hover:bg-slate-50"
        >
          วันถัดไป →
        </button>
        <button
          onClick={() => setDate(todayISO())}
          className="px-3 py-1.5 border border-slate-200 rounded-md hover:bg-slate-50"
        >
          วันนี้
        </button>
        <span className="ml-auto text-slate-500">
          {formatStatementDate(`${date}T00:00:00.000Z`)}
        </span>
      </div>

      {/* Statement upload lives here, not only on the round tab: a day's
          money-in is an everyday question, and it used to require creating a
          month-end round and importing a หักไม่ได้ sheet first. */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-slate-100 text-sm bg-slate-50">
        <span className="text-slate-500">อัปโหลด Statement:</span>
        <select
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          className="border border-slate-300 rounded-md px-2 py-1.5 bg-white"
        >
          <option value="413">413 หนองคาย</option>
          <option value="447">447 บึงกาฬ</option>
        </select>
        <label className="px-3 py-1.5 border border-slate-300 rounded-md bg-white cursor-pointer hover:bg-slate-50">
          {uploading ? "กำลังอ่าน…" : "เลือกไฟล์"}
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={uploadStatement}
            disabled={uploading}
            className="hidden"
          />
        </label>
        <span className="text-xs text-slate-400">
          อัปทับไฟล์เดิมได้ ไม่นับเงินซ้ำ · อัปกี่วันก็ได้ในไฟล์เดียว
        </span>
      </div>

      {uploadNotice && (
        <p className="px-4 py-2 text-sm text-green-700 bg-green-50">{uploadNotice}</p>
      )}

      {actionNotice && (
        <p className="px-4 py-2 text-sm text-green-700 bg-green-50">{actionNotice}</p>
      )}

      {error && <p className="px-4 py-3 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-slate-500 text-sm py-10 text-center">กำลังโหลด…</p>
      ) : !data ? null : !data.loaded ? (
        <p className="text-slate-500 text-sm py-10 text-center px-4">
          ยังไม่มี Statement ที่ครอบคลุมวันนี้ — อัปโหลดไฟล์ของวันนี้ได้ที่แถบด้านบน
          <br />
          <span className="text-xs text-slate-400">
            (ต่างจาก "วันนี้ไม่มีเงินเข้า" — ระบบยังไม่มีข้อมูลของวันนี้เลย)
          </span>
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4 px-4 py-2.5 border-b border-slate-100 text-sm bg-slate-50">
            <span className="text-slate-500">
              เงินเข้า{" "}
              <strong className="num text-slate-900">{totals?.depositCount}</strong> รายการ{" "}
              <Money value={totals?.depositAmount ?? 0} className="font-semibold text-green-700" />
            </span>
            <span className="text-slate-500">
              สลิป <strong className="num text-slate-900">{totals?.slipCount}</strong> ใบ{" "}
              <Money value={totals?.slipAmount ?? 0} className="font-semibold" />
            </span>
            <span className="text-slate-500">
              ส่วนต่าง{" "}
              <Money
                value={gap}
                className={`font-semibold ${gap === 0 ? "text-slate-900" : "text-amber-700"}`}
              />
            </span>
          </div>

          <Section
            title={`✅ ตรงกัน (${data.matched.length} รายการ)`}
            tone="text-green-800"
            note={
              "เงินเข้าและสลิปคู่กันได้ — ไม่ต้องทำอะไร · " +
              'กด "ดูสลิป" เพื่อตรวจคู่ที่ยังไม่แน่ใจได้ โดยเฉพาะแถวที่จับคู่จาก "ยอดตรงเท่านั้น"'
            }
            empty={data.matched.length === 0}
          >
            <table className="w-full text-sm">
              <thead className="text-slate-500 text-left text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-2 py-1.5 font-semibold">เวลา</th>
                  <th className="px-2 py-1.5 font-semibold text-right">ยอด</th>
                  <th className="px-2 py-1.5 font-semibold">ผู้โอน</th>
                  <th className="px-2 py-1.5 font-semibold">ช่องทาง</th>
                  <th className="px-2 py-1.5 font-semibold">สลิปแจ้งว่า</th>
                  <th className="px-2 py-1.5 font-semibold">จับคู่จาก</th>
                  <th className="px-2 py-1.5 font-semibold">สลิป</th>
                </tr>
              </thead>
              <tbody>
                {data.matched.map(({ deposit, slip, basis, dayApart, minutesApart }) => (
                  <tr key={deposit.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <Clock iso={deposit.postedAt} />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <Money value={deposit.amount} className="font-medium" />
                    </td>
                    <td className="px-2 py-1.5">
                      {slip.memberFullName ?? <Payer deposit={deposit} />}
                      {slip.memberNumber && (
                        <span className="num text-xs text-slate-400"> · {slip.memberNumber}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">
                      {CHANNEL_LABELS[deposit.channel] ?? deposit.channel}
                    </td>
                    <td className="px-2 py-1.5 text-slate-500">{slip.category ?? "—"}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-xs">
                      <MatchBasis basis={basis} minutesApart={minutesApart} />
                      {dayApart && (
                        <span className="text-slate-400" title="สลิปลงวันที่คนละวันกับที่ธนาคารบันทึก">
                          {" "}
                          · คนละวัน
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <SlipLink slip={slip} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section
            title={`⚠️ มีสลิปแต่ไม่เจอเงินเข้า (${data.slipsWithoutMoney.length} ใบ)`}
            tone="text-red-700"
            note="สมาชิกส่งสลิปมาแต่หาเงินก้อนที่ตรงกันในบัญชีไม่เจอ — อาจโอนเข้าบัญชีอื่น สลิปซ้ำ หรือสลิปไม่จริง ควรตรวจก่อน"
            empty={data.slipsWithoutMoney.length === 0}
          >
            <SlipTable slips={data.slipsWithoutMoney} />
          </Section>

          {/* Split because these two are not the same job. On a busy day a
              few hundred members transfer without ever telling the bot, and
              that is normal — the ones worth a person's time are the payments
              nobody can even put a name to. Keeping them in one list buried
              the short list under the long one. */}
          <Section
            title={`❓ เงินเข้าที่ไม่รู้ว่าใครโอน (${unknownPayer.length} รายการ)`}
            tone="text-amber-800"
            note={
              "เลขบัญชีผู้โอนไม่ตรงกับใครเลย ทั้งในทะเบียนเลขบัญชีและรายชื่อหักไม่ได้ทุกรอบ — " +
              "เงินเข้ามาจริงแต่ยังไม่รู้ว่าของใคร กลุ่มนี้คือที่ต้องตามหา · " +
              'พอรู้แล้วบันทึกได้ตรงนี้เลย: "ระบุเจ้าของ" = จำเลขบัญชีไว้ใช้ครั้งต่อไป, ' +
              '"บันทึกรายการ" = ลงเป็นรายการของสมาชิกเหมือนสลิปที่ส่งทางไลน์'
            }
            empty={unknownPayer.length === 0}
          >
            <DepositTable
              deposits={unknownPayer}
              actions={{
                acting,
                setActing,
                memberNumber: actMemberNumber,
                setMemberNumber: setActMemberNumber,
                memberName: actMemberName,
                setMemberName: setActMemberName,
                category: actCategory,
                setCategory: setActCategory,
                saving,
                onBind: bindAccount,
                onRecord: recordDeposit,
              }}
            />
          </Section>

          {knownPayer.length > 0 && (
            <div className="px-4 py-3 border-t border-slate-100">
              <button
                onClick={() => setShowKnown((v) => !v)}
                className="text-sm text-slate-600 hover:underline"
              >
                {showKnown ? "▾" : "▸"} เงินเข้าที่รู้ว่าใครโอน แต่ไม่ได้ส่งสลิป (
                {knownPayer.length} รายการ)
              </button>
              <p className="text-xs text-slate-500 mt-1">
                รู้เจ้าของจากเลขบัญชีแล้ว แค่ไม่ได้ส่งสลิปเข้าบอท —
                ปกติเป็นการจ่ายค่าหักไม่ได้ที่แท็บ "เทียบ Statement" จับคู่ให้อยู่แล้ว
                ไม่ต้องทำอะไรเพิ่ม
              </p>
              {showKnown && (
                <div className="overflow-x-auto mt-2">
                  <DepositTable deposits={knownPayer} />
                </div>
              )}
            </div>
          )}

          {data.otherLines.length > 0 && (
            <div className="px-4 py-3 border-t border-slate-100">
              <button
                onClick={() => setShowOther((v) => !v)}
                className="text-sm text-slate-600 hover:underline"
              >
                {showOther ? "▾" : "▸"} รายการอื่นในบัญชีวันนี้ ({data.otherLines.length} รายการ)
              </button>
              <p className="text-xs text-slate-500 mt-1">
                รายการที่ไม่ใช่สมาชิกโอนเข้ามา — เงินหน่วยงาน ฌาปนกิจ ค่าธรรมเนียม เงินโอนออก
                ไม่นับในการเทียบด้านบน แต่แสดงไว้ให้เห็น
                <strong>ถ้าเจอรหัสที่ควรจะนับเป็นเงินสมาชิก บอกได้ จะเพิ่มให้</strong>
              </p>
              {showOther && <OtherTable lines={data.otherLines} />}
            </div>
          )}
        </>
      )}
    </section>
  );
}

const Section = ({
  title,
  tone,
  note,
  empty,
  children,
}: {
  title: string;
  tone: string;
  note: string;
  empty: boolean;
  children: React.ReactNode;
}) => (
  <div className="px-4 py-3 border-t border-slate-100">
    <h3 className={`text-sm font-semibold ${tone}`}>{title}</h3>
    <p className="text-xs text-slate-500 mt-1">{note}</p>
    {empty ? (
      <p className="text-sm text-slate-400 py-3">— ไม่มี —</p>
    ) : (
      <div className="overflow-x-auto mt-2">{children}</div>
    )}
  </div>
);

const SlipTable = ({ slips }: { slips: DailySlipRow[] }) => (
  <table className="w-full text-sm">
    <thead className="text-slate-500 text-left text-xs uppercase tracking-wide">
      <tr>
        <th className="px-2 py-1.5 font-semibold text-right">ยอด</th>
        <th className="px-2 py-1.5 font-semibold">สมาชิก</th>
        <th className="px-2 py-1.5 font-semibold">แจ้งว่าเป็น</th>
        <th className="px-2 py-1.5 font-semibold">วันที่/เวลาบนสลิป</th>
        <th className="px-2 py-1.5 font-semibold">บัญชีผู้โอนบนสลิป</th>
        <th className="px-2 py-1.5 font-semibold">สลิป</th>
      </tr>
    </thead>
    <tbody>
      {slips.map((slip) => (
        <tr key={slip.id} className="border-t border-slate-100 hover:bg-slate-50">
          <td className="px-2 py-1.5 text-right">
            <Money value={slip.amount} className="font-medium" />
          </td>
          <td className="px-2 py-1.5">
            {slip.memberFullName ?? "—"}
            {slip.memberNumber && (
              <span className="num text-xs text-slate-400"> · {slip.memberNumber}</span>
            )}
          </td>
          <td className="px-2 py-1.5 text-slate-500">{slip.category ?? "—"}</td>
          <td className="px-2 py-1.5 num text-slate-500 whitespace-nowrap">
            {formatStatementDate(slip.date)}
            {slip.transferTime && <span className="text-slate-900"> {slip.transferTime}</span>}
          </td>
          {/* The one thing that turns an unexplained slip into something staff
              can actually look up in the statement themselves. */}
          <td className="px-2 py-1.5 font-mono text-xs whitespace-nowrap">
            {slip.senderAccount ?? <span className="text-slate-300">—</span>}
          </td>
          <td className="px-2 py-1.5">
            <SlipLink slip={slip} />
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

// What staff can do with an unclaimed deposit, and the forms behind the two
// buttons. Everything here is optional: the table renders read-only when no
// handlers are passed, which is what the "already know who paid, just no
// slip" list wants.
interface DepositActions {
  acting: { id: string; kind: "bind" | "record" } | null;
  setActing: (next: { id: string; kind: "bind" | "record" } | null) => void;
  memberNumber: string;
  setMemberNumber: (value: string) => void;
  memberName: string;
  setMemberName: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  saving: boolean;
  onBind: (accountNumber: string) => void;
  onRecord: (depositId: string) => void;
}

const DepositTable = ({
  deposits,
  actions,
}: {
  deposits: DailyDepositRow[];
  actions?: DepositActions;
}) => (
  <table className="w-full text-sm">
    <thead className="text-slate-500 text-left text-xs uppercase tracking-wide">
      <tr>
        <th className="px-2 py-1.5 font-semibold">เวลา</th>
        <th className="px-2 py-1.5 font-semibold text-right">ยอด</th>
        <th className="px-2 py-1.5 font-semibold">ผู้โอน</th>
        <th className="px-2 py-1.5 font-semibold">ช่องทาง</th>
        <th className="px-2 py-1.5 font-semibold">เข้าบัญชี</th>
        <th className="px-2 py-1.5 font-semibold">รายละเอียดในสเตทเมนต์</th>
        {actions && <th className="px-2 py-1.5 font-semibold">ทำอะไรได้</th>}
      </tr>
    </thead>
    <tbody>
      {deposits.map((deposit) => {
        const open = actions?.acting?.id === deposit.id ? actions.acting.kind : null;
        const caveat = accountCaveat(deposit.channel);

        return (
          <Fragment key={deposit.id}>
            <tr className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-2 py-1.5 whitespace-nowrap">
                <Clock iso={deposit.postedAt} />
              </td>
              <td className="px-2 py-1.5 text-right">
                <Money value={deposit.amount} className="font-medium" />
              </td>
              <td className="px-2 py-1.5">
                <Payer deposit={deposit} />
              </td>
              <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">
                {CHANNEL_LABELS[deposit.channel] ?? deposit.channel}
              </td>
              <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">{deposit.branch}</td>
              <td className="px-2 py-1.5 font-mono text-xs text-slate-400">
                {deposit.description}
              </td>
              {actions && (
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-3 text-xs">
                    {/* Offered whenever the statement named any digits at all.
                        Where those digits are doubtful the button carries the
                        reason rather than disappearing — the person on the
                        phone knows more about the payment than the
                        transaction code does. */}
                    {canBindAccount(deposit) && (
                      <button
                        onClick={() => {
                          actions.setActing({ id: deposit.id, kind: "bind" });
                          actions.setMemberNumber("");
                          actions.setMemberName("");
                          actions.setCategory("");
                        }}
                        className={`hover:underline ${caveat ? "text-amber-700" : "text-slate-900"}`}
                        title={caveat ?? "จำไว้ว่าเลขบัญชีนี้เป็นของสมาชิกคนนี้ ใช้ได้ทุกครั้งต่อไป"}
                      >
                        ระบุเจ้าของ{caveat && " ⚠️"}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        actions.setActing({ id: deposit.id, kind: "record" });
                        actions.setMemberNumber("");
                        actions.setMemberName("");
                        actions.setCategory("");
                      }}
                      className="text-slate-900 hover:underline"
                      title="บันทึกเงินก้อนนี้เป็นรายการของสมาชิก เหมือนที่สลิปทางไลน์ทำ"
                    >
                      บันทึกรายการ
                    </button>
                  </span>
                </td>
              )}
            </tr>

            {actions && open && (
              <tr className="bg-slate-50 border-t border-slate-100">
                <td colSpan={7} className="px-3 py-2.5">
                  {open === "bind" && caveat && (
                    <p className="text-xs text-amber-800 mb-2">⚠️ {caveat}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-slate-500">
                      {open === "bind"
                        ? `เลขบัญชี ${deposit.senderAccount} เป็นของสมาชิกเลข`
                        : `${formatAmount(deposit.amount)} นี้ เป็นเงินของสมาชิกเลข`}
                    </span>
                    <input
                      value={actions.memberNumber}
                      onChange={(e) => actions.setMemberNumber(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") actions.setActing(null);
                        if (e.key === "Enter" && actions.memberNumber.trim()) {
                          if (open === "bind" && deposit.senderAccount) {
                            actions.onBind(deposit.senderAccount);
                          } else if (open === "record" && actions.category) {
                            actions.onRecord(deposit.id);
                          }
                        }
                      }}
                      placeholder="เลขสมาชิก"
                      autoFocus
                      className="border border-slate-300 rounded px-2 py-1 w-40 bg-white"
                    />
                    {open === "record" && (
                      <>
                        <input
                          value={actions.memberName}
                          onChange={(e) => actions.setMemberName(e.target.value)}
                          placeholder="ชื่อ-นามสกุล (ใส่เมื่อไม่มีในทะเบียน)"
                          title="ปล่อยว่างได้ถ้าเลขสมาชิกมีในทะเบียนอยู่แล้ว — ระบบจะใช้ชื่อจากทะเบียนเสมอ"
                          className="border border-slate-300 rounded px-2 py-1 w-64 bg-white"
                        />
                        <span className="text-slate-500">จ่ายเป็น</span>
                        <select
                          value={actions.category}
                          onChange={(e) => actions.setCategory(e.target.value)}
                          className="border border-slate-300 rounded px-2 py-1 bg-white"
                        >
                          <option value="">— เลือก —</option>
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                    <button
                      onClick={() => {
                        if (open === "bind" && deposit.senderAccount) {
                          actions.onBind(deposit.senderAccount);
                        } else if (open === "record") {
                          actions.onRecord(deposit.id);
                        }
                      }}
                      disabled={
                        actions.saving ||
                        !actions.memberNumber.trim() ||
                        (open === "record" && !actions.category)
                      }
                      className="px-3 py-1 rounded bg-slate-900 text-white disabled:opacity-40"
                    >
                      {actions.saving ? "กำลังบันทึก…" : "บันทึก"}
                    </button>
                    <button
                      onClick={() => actions.setActing(null)}
                      className="text-slate-500 hover:underline"
                    >
                      ยกเลิก
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    {open === "bind"
                      ? "ผูกเลขบัญชีไว้กับสมาชิก — ไม่ได้บันทึกเงินก้อนนี้เป็นรายการ ถ้าต้องการบันทึกด้วย ให้กด \"บันทึกรายการ\" อีกที"
                      : "ยอดและวันที่ใช้ตามที่ธนาคารบันทึกไว้ ไม่ต้องพิมพ์เอง · ชื่อใส่เฉพาะตอนที่เลขสมาชิกยังไม่มีในทะเบียน (ถ้ามีแล้วระบบใช้ชื่อจากทะเบียน) — ถ้าบันทึกผิด ลบได้ที่แท็บ \"รายการ\""}
                  </p>
                </td>
              </tr>
            )}
          </Fragment>
        );
      })}
    </tbody>
  </table>
);

const OtherTable = ({ lines }: { lines: DailyOtherLineRow[] }) => (
  <div className="overflow-x-auto mt-2">
    <table className="w-full text-sm">
      <thead className="text-slate-500 text-left text-xs uppercase tracking-wide">
        <tr>
          <th className="px-2 py-1.5 font-semibold">เวลา</th>
          <th className="px-2 py-1.5 font-semibold text-right">ยอด</th>
          <th className="px-2 py-1.5 font-semibold">รหัส</th>
          <th className="px-2 py-1.5 font-semibold">รายละเอียด</th>
          <th className="px-2 py-1.5 font-semibold">บัญชี</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.id} className="border-t border-slate-100 hover:bg-slate-50">
            <td className="px-2 py-1.5 whitespace-nowrap">
              <Clock iso={line.postedAt} />
            </td>
            <td className="px-2 py-1.5 text-right">
              <Money
                value={line.amount}
                className={line.amount < 0 ? "text-slate-500" : "text-slate-900"}
              />
            </td>
            <td className="px-2 py-1.5 font-mono text-xs">{line.txnCode}</td>
            <td className="px-2 py-1.5 text-slate-500">{line.description}</td>
            <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">{line.branch}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
