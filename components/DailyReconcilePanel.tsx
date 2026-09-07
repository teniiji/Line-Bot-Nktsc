"use client";

import { useCallback, useEffect, useState } from "react";
import { formatAmount, formatStatementDate, formatStatementTime } from "@/lib/format";
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

// Why this pair was made, said plainly enough that a person can decide
// whether to trust it. The four are genuinely different levels of evidence,
// so they get four different labels rather than a tick.
const MatchBasis = ({
  basis,
  minutesApart,
}: {
  basis: DailyReconcileResult["matched"][number]["basis"];
  minutesApart: number | null;
}) => {
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
          เทียบ <strong>เงินที่เข้าบัญชีสหกรณ์วันนั้น</strong> (จาก Statement ที่อัปโหลดในแท็บ
          "เทียบ Statement" — ใช้ไฟล์เดียวกัน ไม่ต้องอัปซ้ำ) กับ{" "}
          <strong>สลิปที่สมาชิกส่งเข้าบอท</strong> วันเดียวกัน เพื่อจับ 2 อย่าง:
          สลิปที่ไม่มีเงินเข้าจริง และเงินที่เข้ามาโดยไม่มีใครแจ้ง
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

      {error && <p className="px-4 py-3 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-slate-500 text-sm py-10 text-center">กำลังโหลด…</p>
      ) : !data ? null : !data.loaded ? (
        <p className="text-slate-500 text-sm py-10 text-center px-4">
          ยังไม่มี Statement ที่ครอบคลุมวันนี้ — อัปโหลดในแท็บ "เทียบ Statement" ก่อน
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
            note="เงินเข้าและสลิปคู่กันได้ — ไม่ต้องทำอะไร"
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
            note="เลขบัญชีผู้โอนไม่ตรงกับใครเลย ทั้งในทะเบียนเลขบัญชีและรายชื่อหักไม่ได้ทุกรอบ — เงินเข้ามาจริงแต่ยังไม่รู้ว่าของใคร กลุ่มนี้คือที่ต้องตามหา"
            empty={unknownPayer.length === 0}
          >
            <DepositTable deposits={unknownPayer} />
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
            {slip.slipImageUrl ? (
              <a
                href={slip.slipImageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-900 hover:underline"
              >
                ดูสลิป
              </a>
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

const DepositTable = ({ deposits }: { deposits: DailyDepositRow[] }) => (
  <table className="w-full text-sm">
    <thead className="text-slate-500 text-left text-xs uppercase tracking-wide">
      <tr>
        <th className="px-2 py-1.5 font-semibold">เวลา</th>
        <th className="px-2 py-1.5 font-semibold text-right">ยอด</th>
        <th className="px-2 py-1.5 font-semibold">ผู้โอน</th>
        <th className="px-2 py-1.5 font-semibold">ช่องทาง</th>
        <th className="px-2 py-1.5 font-semibold">เข้าบัญชี</th>
        <th className="px-2 py-1.5 font-semibold">รายละเอียดในสเตทเมนต์</th>
      </tr>
    </thead>
    <tbody>
      {deposits.map((deposit) => (
        <tr key={deposit.id} className="border-t border-slate-100 hover:bg-slate-50">
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
          <td className="px-2 py-1.5 font-mono text-xs text-slate-400">{deposit.description}</td>
        </tr>
      ))}
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
