"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  formatAmount,
  formatStatementDate,
  formatStatementTime,
  formatStatementTimeExact,
} from "@/lib/format";
import { STAFF_CATEGORIES, categoryNeedsDetail } from "@/lib/categories";
import { accountCaveat, canBindAccount } from "@/lib/depositRecord";
import { CHANNEL_LABELS, STAFF_CHANNEL } from "@/lib/statementLines";
import { STATUS_LABELS, canRecordFromLine } from "@/lib/statementDayView";
import { STATEMENT_ACCOUNTS } from "@/lib/statementReconcile";
import { branchesIn, missingBranches, summariseByAccount } from "@/lib/dailyAccountSummary";
import { dayTally, flowByAccount, flowTotal, inByCategory } from "@/lib/statementTotals";
import { bankFromDescription } from "@/lib/thaiBanks";
import { cooperativeToday, shiftDay } from "@/lib/cooperativeClock";
import { describeDeductionHint, type DeductionHint } from "@/lib/deductionMatch";
import { overlapsAnotherAccount, type StatementUpload } from "@/lib/statementUploads";
import {
  bindMissedRoundNote,
  recordBridgedRoundNote,
  recordMissedRoundNote,
} from "@/lib/roundReach";
import { DEDUCTION_CATEGORY } from "@/lib/statementSlipHints";
import {
  SECTION_OPEN_BY_DEFAULT,
  allSections,
  sectionOpen,
  type SectionKey,
} from "@/lib/dailySections";
import PanelHelp from "@/components/PanelHelp";
import DateField from "@/components/DateField";
import LineSplitDialog from "@/components/LineSplitDialog";
import { suggestedPayerName } from "@/lib/unitPayer";
import {
  depositHaystack,
  filterBy,
  filterStatementRows,
  matchedPairHaystack,
  otherLineHaystack,
  slipHaystack,
} from "@/lib/statementSearch";
import {
  DailyDepositRow,
  DailyOtherLineRow,
  DailyReconcileResult,
  DailySlipRow,
  DailySplitDepositRow,
  DailyStatementRow,
} from "@/lib/types";

// The day it is at the cooperative, not on this device: the tab opens on
// today's money, and a browser reading UTC opens on yesterday's until seven in
// the morning. shiftDay is the same day arithmetic this file had, moved into
// lib/cooperativeClock.ts so every preset in the dashboard agrees on it.
const todayISO = () => cooperativeToday();

const Money = ({ value, className = "" }: { value: number; className?: string }) => (
  <span className={`num whitespace-nowrap ${className}`}>{formatAmount(value)}</span>
);

// Over more than one day every table has the same problem the statement one
// had: rows ordered by the full timestamp read 11:12, then 20:12, then 07:01,
// and nothing on screen says why.
const Clock = ({ iso, withDate = false }: { iso: string | null; withDate?: boolean }) => {
  const time = formatStatementTime(iso);
  if (!time) return <span className="num text-slate-500">{formatStatementDate(iso)}</span>;
  if (!withDate) return <span className="num text-slate-500">{time}</span>;
  return (
    <span className="num block leading-tight text-slate-500">
      <span className="block text-xs text-slate-400">{formatStatementDate(iso)}</span>
      <span className="block">{time}</span>
    </span>
  );
};

// "(21 รายการ)" while everything is shown, "(3 จาก 21 รายการ)" while a search
// is narrowing it — so a heading never quietly reports a filtered count as if
// it were the whole thing.
const countLabel = (shown: number, total: number, unit: string) =>
  shown === total ? `${total} ${unit}` : `${shown} จาก ${total} ${unit}`;

// The same, with the seconds kept. Only the statement table uses it: that is
// the one read line by line against the bank's printout, where the seconds
// separate two postings in the same minute.
//
// Over more than one day the date has to come with it. The rows are ordered
// by the full timestamp, so across days the times read 11:12, then 20:12,
// then 07:01 — which looks like a sorting fault rather than a new day, and
// two postings from the same payer account on different days read as one
// duplicated line.
const ExactClock = ({ iso, withDate = false }: { iso: string | null; withDate?: boolean }) => {
  const time = formatStatementTimeExact(iso);
  if (!time) return <span className="num text-slate-500">{formatStatementDate(iso)}</span>;
  if (!withDate) return <span className="num text-slate-500">{time}</span>;
  return (
    <span className="num block leading-tight text-slate-500">
      <span className="block text-xs text-slate-400">{formatStatementDate(iso)}</span>
      <span className="block">{time}</span>
    </span>
  );
};

// The bank's own text for a line, with the paying bank spelled out when the
// line names one. A counter deposit arrives as "014-8592630385": the three
// digits are the paying bank's interbank code, so the line already says which
// bank the member used — it just says it in a form nobody reads at a glance,
// and "which bank did you pay from" is the question staff ring to ask.
//
// The raw text stays exactly as the bank wrote it, because it is what a
// person ties out against the printout; the name is added beside it.
const StatementDetail = ({ description }: { description: string }) => {
  const bank = bankFromDescription(description);
  return (
    <span>
      <span className="font-mono text-xs text-slate-400">{description}</span>
      {bank && <span className="text-xs text-slate-600"> · ธ.{bank.name}</span>}
    </span>
  );
};

// Who a payment came from, as far as anything knows. The account number is
// what staff match against the bank; the member number is only there when the
// directory recognised it.
const Payer = ({ deposit }: { deposit: DailyDepositRow }) => (
  <span>
    {deposit.memberNumber ? (
      <span>
        <span className="num">{deposit.memberNumber}</span>
        {deposit.payerName && !deposit.senderAccount && (
          <span className="text-xs text-slate-500" title="รู้จากหน่วยงานที่โอน — เคยบันทึกยอดของหน่วยงานนี้ให้สมาชิกคนนี้">
            {" "}· 🏢 {deposit.payerName}
          </span>
        )}
      </span>
    ) : deposit.payerName ? (
      // A unit staff named when dividing an earlier line worded the same way.
      <span className="text-slate-700" title="หน่วยงานที่เคยแบ่งยอดให้สมาชิกไว้ — กด &quot;แบ่งให้หลายคน&quot; รายชื่อเดิมจะขึ้นให้">
        🏢 {deposit.payerName}
      </span>
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
  // A range, defaulting to the single day this tab has always shown. Staff
  // chasing a payment do not always know which day it landed on.
  const [from, setFrom] = useState(todayISO);
  const [to, setTo] = useState(todayISO);
  const [search, setSearch] = useState("");
  // "" is both accounts together, which is how the tab has always opened.
  const [branch, setBranch] = useState("");
  const [data, setData] = useState<DailyReconcileResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // What this person has clicked open or shut. Empty until they touch a
  // section, which is what lets the defaults and the search rule apply — see
  // lib/dailySections.ts.
  const [clicked, setClicked] = useState<Partial<Record<SectionKey, boolean>>>({});
  // Uploading right here rather than sending staff to the round tab: checking
  // one day's money has nothing to do with the month-end round.
  const [account, setAccount] = useState("413");
  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  // What has been loaded, and the way to take one back out. Null until asked
  // for: most visits never need it.
  const [showUploads, setShowUploads] = useState(false);
  const [uploads, setUploads] = useState<StatementUpload[] | null>(null);
  // Which unclaimed deposit has its form open, and which of the two answers
  // it is being given. Only one at a time — the work is one payment, one
  // phone call.
  const [acting, setActing] = useState<ActingTarget | null>(null);
  const [actMemberNumber, setActMemberNumber] = useState("");
  // Starts unchosen on purpose. Defaulting to the first category would let a
  // distracted click file a ฿90,000 payment as ซื้อหุ้น without anyone having
  // decided that — the category is what routes the payment to a department.
  const [actCategory, setActCategory] = useState<string>("");
  // Only used when the roster does not know the number. Optional on purpose:
  // most numbers are in the roster and the name comes from there, so making
  // it required would tax every recording for the sake of the few.
  const [actMemberName, setActMemberName] = useState("");
  // What an "อื่นๆ" payment was actually for. Required only for that one
  // category, and written into the transaction's own description.
  const [actNote, setActNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  // The bank line being divided among several members, while its dialog is
  // open — see components/LineSplitDialog.tsx.
  const [splittingId, setSplittingId] = useState<string | null>(null);
  // Offered after a recording, when the line's account is plainly the payer's
  // and nothing had claimed it — one click to make the next transfer from it
  // recognise itself.
  const [bindOffer, setBindOffer] = useState<{
    accountNumber: string;
    memberNumber: string;
    memberName: string | null;
  } | null>(null);
  // Said when something done here has not reached the หักไม่ได้ round, which
  // is invisible otherwise — see lib/roundReach.ts.
  const [roundNote, setRoundNote] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  // One-time catch-up for recordings filed before the bridge above existed
  // — see app/api/statement-lines/backfill-bridge/route.ts.
  const [backfillNotice, setBackfillNotice] = useState<string | null>(null);
  const [fixingRounds, setFixingRounds] = useState(false);
  // One-time repair for bridged transfers placed by "newest round" instead
  // of the round the payment's own date falls in — see
  // app/api/statement-lines/fix-bridge-rounds/route.ts.
  const [fixRoundsNotice, setFixRoundsNotice] = useState<string | null>(null);

  const fetchDay = useCallback(async (start: string, end: string) => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/daily-reconcile?from=${start}&to=${end}`);
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
    fetchDay(from, to);
  }, [from, to, fetchDay]);

  // A new search makes every section a different list, so what was folded
  // about the old one stops meaning anything. Without this, ย่อทั้งหมด
  // followed by a search left the hits hidden behind seven closed headers —
  // the counts updated, the rows did not appear, and the page read as though
  // the box had found nothing.
  useEffect(() => {
    setClicked({});
  }, [search]);

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
      await fetchDay(from, to);
    } finally {
      setUploading(false);
    }
  };

  const fetchUploads = useCallback(async () => {
    setUploads(null);
    const res = await fetch("/api/statement-lines/uploads");
    const body = await res.json();
    setUploads(res.ok ? body.uploads : []);
  }, []);

  // Taking one back out. Refused by the route while a transaction is filed
  // against any of its lines, which is the one case where deleting would take
  // somebody's payment down with it.
  const removeUpload = async (upload: StatementUpload) => {
    setSaving(true);
    setError(null);
    setUploadNotice(null);
    try {
      const res = await fetch("/api/statement-lines/uploads", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: upload.account, sourceFile: upload.sourceFile }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "ลบไฟล์ไม่สำเร็จ");
        return;
      }
      setUploadNotice(
        `ลบ ${body.removed} บรรทัดของไฟล์ ${upload.sourceFile ?? "(ไม่ทราบชื่อไฟล์)"} ` +
          `ออกจากบัญชี ${upload.account} ${upload.branch} แล้ว`
      );
      await fetchUploads();
      await fetchDay(from, to);
    } finally {
      setSaving(false);
    }
  };

  const closeForm = () => {
    setActing(null);
    setActMemberNumber("");
    setActMemberName("");
    setActCategory("");
    setActNote("");
  };

  // Opening one form closes whatever was open, and starts the fields from
  // what the row already knows. The category is left blank on principle — a
  // category defaulted for somebody is a category nobody chose — except when
  // the row itself already told staff what this payment is: the row's own
  // green or amber "เก็บไม่ได้ ..." text made that call before the click, not
  // this form making it silently. A weaker hint (short/over — the amount
  // does not actually match) still leaves it blank, because there the row is
  // raising a question, not answering one.
  const openForm = (
    target: ActingTarget,
    memberNumber: string | null = null,
    category: string | null = null
  ) => {
    setBindOffer(null);
    setRoundNote(null);
    setActing(target);
    setActMemberNumber(memberNumber ?? "");
    setActMemberName("");
    setActCategory(category ?? "");
    setActNote("");
  };

  // "That account is นาง X's" — a fact about an account, so it goes to the
  // directory and holds for every future transfer from it. Deliberately not
  // combined with recording the payment: the same call often answers only one
  // of the two, and pretending otherwise would file a transaction nobody
  // asked for.
  const bindAccount = async (accountNumber: string, memberNumber = actMemberNumber) => {
    setSaving(true);
    setError(null);
    setActionNotice(null);
    setRoundNote(null);
    setBindOffer(null);
    try {
      const res = await fetch("/api/member-bank-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountNumber,
          memberNumber: memberNumber.trim(),
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
      // Binding can only re-match transfers a round already holds, so where
      // the statement never went into one, nothing moved there and the notice
      // above would otherwise read as though it had.
      setRoundNote(bindMissedRoundNote(body.rounds ?? 0, data?.round ?? null));
      closeForm();
      await fetchDay(from, to);
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
    setRoundNote(null);
    try {
      const res = await fetch(`/api/statement-lines/${depositId}/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberNumber: actMemberNumber.trim(),
          memberName: actMemberName.trim(),
          category: actCategory,
          note: actNote.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "บันทึกรายการไม่สำเร็จ");
        return;
      }
      setActionNotice(
        `บันทึก ${formatAmount(body.amount)} เป็น "${body.category}"` +
          // For อื่นๆ the category alone does not say what was filed, so the
          // confirmation repeats what the person wrote.
          (actNote.trim() ? ` (${actNote.trim()})` : "") +
          ` ให้ ${body.memberNumber} ${body.memberFullName ?? ""} แล้ว` +
          (body.inRoster ? "" : " — ⚠️ ไม่พบเลขสมาชิกนี้ในทะเบียนสมาชิก ตรวจสอบอีกครั้ง")
      );
      // A round keeps score from the statement uploaded into it and has never
      // read a transaction, so filing one as a deduction payment used to
      // leave the member still owing there — the route now writes it
      // through when the round agrees this member still owes (see
      // lib/roundReach.ts), so the confirmation replaces the warning
      // wherever that happened.
      setRoundNote(
        body.bridgedRound
          ? recordBridgedRoundNote(body.bridgedRound, 1, 1)
          : recordMissedRoundNote(actCategory, DEDUCTION_CATEGORY, data?.round ?? null)
      );

      // Recording says what this one payment was. It does not teach the
      // system whose account the money came from — which is why the same
      // member's next transfer arrives as money nobody can name, and why
      // "เหมือนเคยบันทึกสมาชิกแล้วแต่ไม่ขึ้นสมาชิก" is the reasonable thing
      // to conclude. So when the line carries an account that is plainly the
      // payer's and nothing has claimed it yet, the offer is made here, once,
      // with the number already known.
      const line = (data?.statement ?? []).find((row) => row.id === depositId);
      if (line?.senderAccount && !line.memberNumber && !accountCaveat(line)) {
        setBindOffer({
          accountNumber: line.senderAccount,
          memberNumber: body.memberNumber,
          memberName: body.memberFullName ?? null,
        });
      }

      closeForm();
      await fetchDay(from, to);
    } finally {
      setSaving(false);
    }
  };

  // The same recording as onRecord above, run once per line instead of once
  // per click. Only ever called with lines the table itself decided were
  // eligible (see strongDeductionCategory below) — a known payer and a match
  // the round already vouches for — so there is nothing left here to ask a
  // person about; this is the click that used to open a form, choose the one
  // category on offer, and confirm it, done the same way for everything
  // selected instead of once per row.
  const bulkRecordDeposits = async (
    targets: { id: string; memberNumber: string; category: string }[]
  ) => {
    setSaving(true);
    setError(null);
    setActionNotice(null);
    setRoundNote(null);
    let recorded = 0;
    let bridged = 0;
    let bridgedRound: { period: string; label: string } | null = null;
    const failures: string[] = [];
    try {
      // Sequential, not Promise.all: these are ordinary POSTs against the
      // same day, and running them one at a time is what keeps a partial
      // failure's error message attributable to the row it belongs to rather
      // than a pile of responses arriving in no particular order.
      for (const target of targets) {
        const res = await fetch(`/api/statement-lines/${target.id}/record`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberNumber: target.memberNumber, category: target.category }),
        });
        if (res.ok) {
          recorded += 1;
          const body = await res.json().catch(() => ({}) as { bridgedRound?: unknown });
          if (body.bridgedRound) {
            bridged += 1;
            bridgedRound = body.bridgedRound as { period: string; label: string };
          }
        } else {
          const body = await res.json().catch(() => ({}) as { error?: string });
          failures.push(body.error || "บันทึกไม่สำเร็จ");
        }
      }
    } finally {
      setSaving(false);
    }

    setActionNotice(
      recorded > 0
        ? `บันทึกแล้ว ${recorded} รายการ เป็น "${DEDUCTION_CATEGORY}"` +
          (failures.length > 0 ? ` · ไม่สำเร็จ ${failures.length} รายการ (${failures[0]})` : "")
        : `บันทึกไม่สำเร็จทั้ง ${failures.length} รายการ (${failures[0]})`
    );
    if (recorded > 0) {
      setRoundNote(
        bridgedRound
          ? recordBridgedRoundNote(bridgedRound, bridged, recorded)
          : recordMissedRoundNote(DEDUCTION_CATEGORY, DEDUCTION_CATEGORY, data?.round ?? null)
      );
    }
    await fetchDay(from, to);
  };

  // Runs the same bridge the record route above now does live, but over
  // everything ever filed as the deduction category — catches recordings
  // made before that fix existed. Safe to click more than once: anything
  // already bridged is skipped, so a second click just confirms there is
  // nothing left.
  const runBackfillBridge = async () => {
    setBackfilling(true);
    setBackfillNotice(null);
    try {
      const res = await fetch("/api/statement-lines/backfill-bridge", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setBackfillNotice(body.error || "เชื่อมย้อนหลังไม่สำเร็จ");
        return;
      }
      setBackfillNotice(
        (body.bridged > 0
          ? `เชื่อมย้อนหลังสำเร็จ ${body.bridged} รายการ`
          : `ไม่มีรายการที่ต้องเชื่อมย้อนหลัง`) +
          (body.notEligible > 0
            ? ` · อีก ${body.notEligible} รายการไม่เข้าเงื่อนไข (ไม่มีรอบของเดือนนั้น หรือรอบนั้นไม่เห็นว่าค้าง)`
            : "") +
          // A member with more than one stale recording gets only the oldest
          // bridged automatically — the rest need a person to look at them,
          // since guessing which one is real and which is something else
          // (an earlier month's payment, a genuine double transfer) is
          // exactly the mistake that produced the first version of this.
          (body.skippedDuplicateMember > 0
            ? ` · ${body.skippedDuplicateMember} รายการข้ามไว้เพราะสมาชิกคนเดียวกันมีมากกว่า 1 รายการที่ยังไม่เชื่อม ตรวจสอบเองว่าเป็นเดือนไหน`
            : "") +
          (body.alreadyCoveredByFile > 0
            ? ` · อีก ${body.alreadyCoveredByFile} รายการไม่เชื่อม เพราะไฟล์ Statement ของรอบมีรายการนี้นับไว้อยู่แล้ว`
            : "")
      );
      await fetchDay(from, to);
    } finally {
      setBackfilling(false);
    }
  };

  // Repairs bridged transfers (this one's, and the live record route's)
  // written before both were fixed to place a payment by the round its own
  // date falls in rather than by "whichever round is newest" — see
  // app/api/statement-lines/fix-bridge-rounds/route.ts. Safe to click more
  // than once: a transfer already in its correct round is left alone.
  const runFixBridgeRounds = async () => {
    setFixingRounds(true);
    setFixRoundsNotice(null);
    try {
      const res = await fetch("/api/statement-lines/fix-bridge-rounds", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setFixRoundsNotice(body.error || "แก้รอบไม่สำเร็จ");
        return;
      }
      setFixRoundsNotice(
        body.moved === 0 && body.removedDuplicate === 0 && body.removedUnplaceable === 0
          ? `ไม่มีรายการที่ต้องแก้ (${body.scanned} รายการที่ตรวจ ถูกต้องอยู่แล้วทั้งหมด)`
          : `ย้ายไปรอบที่ถูกต้อง ${body.moved} รายการ` +
            (body.removedDuplicate > 0
              ? ` · เอาออก ${body.removedDuplicate} รายการ เพราะเป็นยอดเดียวกับที่ไฟล์ Statement ของรอบนับไว้อยู่แล้ว (นับซ้ำ)`
              : "") +
            (body.removedUnplaceable > 0
              ? ` · เอาออกอีก ${body.removedUnplaceable} รายการ (ไม่มีรอบของเดือนนั้น หรือรอบนั้นไม่เห็นว่าค้างแล้ว — กลับเป็นรายการที่ยังไม่เชื่อม ไปดูได้ที่รายการของเดือนนั้น)`
              : "")
      );
      await fetchDay(from, to);
    } finally {
      setFixingRounds(false);
    }
  };

  // "The bank's code does not know it, but that one is a member paying in" —
  // a fact about this line only. It files nothing: it moves the row up into
  // the unclaimed list, where the same two buttons as every other unclaimed
  // payment ask who paid and what for. See lib/memberMoneyMark.ts.
  const markMemberMoney = async (lineId: string) => {
    setSaving(true);
    setError(null);
    setActionNotice(null);
    setRoundNote(null);
    try {
      const res = await fetch(`/api/statement-lines/${lineId}/member-money`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "ระบุเป็นเงินสมาชิกไม่สำเร็จ");
        return;
      }
      setActionNotice(
        `ย้าย ${formatAmount(body.amount)} ไปอยู่ใน "เงินเข้าที่ไม่รู้ว่าใครโอน" แล้ว — ` +
          'บันทึกเป็นรายการของสมาชิกได้ที่นั่น · ถ้าระบุผิด กด "ไม่ใช่เงินสมาชิก" ที่แถวนั้นเพื่อย้อนกลับ'
      );
      await fetchDay(from, to);
    } finally {
      setSaving(false);
    }
  };

  // "🏢 เพิ่มเป็นหน่วยงาน" on a unit's line under รายการอื่น: the unit goes on
  // the list (components/UnitPayersPanel.tsx) and every line of it moves into
  // the member-money lists, this one included — see lib/unitPayerStore.ts.
  const [unitForm, setUnitForm] = useState<{ lineId: string; name: string } | null>(null);
  const addUnitFromLine = async (line: DailyOtherLineRow, name: string) => {
    setSaving(true);
    setError(null);
    setActionNotice(null);
    try {
      const res = await fetch("/api/unit-payers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: line.description, name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "เพิ่มหน่วยงานไม่สำเร็จ");
        return;
      }
      setUnitForm(null);
      setActionNotice(
        `เพิ่มหน่วยงาน "${body.name}" แล้ว — ย้ายยอดของหน่วยงานนี้ ${body.moved ?? 0} รายการไปอยู่ใน ` +
          '"เงินเข้าที่ไม่รู้ว่าใครโอน" ให้บันทึกหรือแบ่งให้สมาชิกต่อ · ยอดเดือนต่อไปของหน่วยงานนี้จะย้ายไปให้เอง'
      );
      await fetchDay(from, to);
    } finally {
      setSaving(false);
    }
  };

  // The way back, for a mark that turned out to be wrong. Refused by the route
  // once a transaction has been filed against the line — that one is deleted
  // at the รายการ tab first.
  const unmarkMemberMoney = async (lineId: string) => {
    setSaving(true);
    setError(null);
    setActionNotice(null);
    setRoundNote(null);
    try {
      const res = await fetch(`/api/statement-lines/${lineId}/member-money`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "ย้อนรายการไม่สำเร็จ");
        return;
      }
      setActionNotice(
        `ย้าย ${formatAmount(body.amount)} (${body.txnCode}) กลับไปอยู่ใน "รายการอื่นในบัญชี" แล้ว`
      );
      await fetchDay(from, to);
    } finally {
      setSaving(false);
    }
  };

  // Taking a division back: the members' round rows and transactions go, and
  // the line returns to the list of money nobody has claimed.
  const undoSplit = async (lineId: string) => {
    if (!window.confirm("ยกเลิกการแบ่งยอดนี้? รายการของสมาชิกแต่ละคนและยอดที่นับในรอบจะถูกลบออก")) return;
    setSaving(true);
    setError(null);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/statement-lines/${lineId}/split`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "ยกเลิกการแบ่งไม่สำเร็จ");
        return;
      }
      setActionNotice("ยกเลิกการแบ่งแล้ว — ยอดกลับไปอยู่ในรายการเงินเข้าที่ยังไม่มีเจ้าของ");
      await fetchDay(from, to);
    } finally {
      setSaving(false);
    }
  };

  // Both ends move together, so the arrows still step through days at
  // whatever width the range is set to.
  const shiftRange = (days: number) => {
    setFrom(shiftDay(from, days));
    setTo(shiftDay(to, days));
  };

  // The two accounts are different people's work and different statements to
  // tie out against, so the day is reported per account and can be narrowed
  // to one. Derived from the day itself rather than a hardcoded 413/447, so a
  // third account would appear rather than vanish.
  const day = {
    matched: data?.matched ?? [],
    depositsWithoutSlip: data?.depositsWithoutSlip ?? [],
    otherLines: data?.otherLines ?? [],
    splitDeposits: data?.splitDeposits ?? [],
  };
  const branches = branchesIn(day);
  const perAccount = summariseByAccount(day);
  const absentBranches = missingBranches(day, Object.values(STATEMENT_ACCOUNTS));
  const inBranch = <T extends { branch: string }>(rows: T[]) =>
    branch ? rows.filter((r) => r.branch === branch) : rows;

  // Money nobody claimed, split by whether anything knows who paid it.
  const claimable = inBranch(data?.depositsWithoutSlip ?? []);
  const unknownPayer = claimable.filter((d) => !d.memberNumber);
  const knownPayer = claimable.filter((d) => d.memberNumber);

  // One box over every section, not one per table: a person looking for
  // member 26018 does not know which of the five conclusions their payment
  // ended up under — that is usually the whole reason they are looking.
  // Filtered here rather than server-side, so it answers as you type.
  const statementRows = filterStatementRows(
    branch ? (data?.statement ?? []).filter((r) => r.branch === branch) : (data?.statement ?? []),
    search
  );
  // Money in and money out over exactly the rows on screen — the account
  // filter and the search box included. What is printed is what was being
  // looked at; the report says which filters were on so the page can be read
  // on its own later.
  const flowRows = flowByAccount(statementRows);
  const flowAll = flowTotal(statementRows);
  const categories = inByCategory(statementRows);

  const matchedRows = filterBy(
    branch ? day.matched.filter((p) => p.deposit.branch === branch) : day.matched,
    search,
    matchedPairHaystack
  );
  // Slips are never filtered by account: a slip with no money behind it has
  // no account by definition — that is what makes it unmatched.
  const unmatchedSlips = filterBy(data?.slipsWithoutMoney ?? [], search, slipHaystack);
  const unknownRows = filterBy(unknownPayer, search, depositHaystack);
  const knownRows = filterBy(knownPayer, search, depositHaystack);
  const otherRows = filterBy(inBranch(data?.otherLines ?? []), search, otherLineHaystack);
  const splitRows = filterBy(inBranch(data?.splitDeposits ?? []), search, splitHaystack);
  const searching = search.trim().length > 0;
  const totalHits =
    statementRows.length +
    matchedRows.length +
    unmatchedSlips.length +
    unknownRows.length +
    knownRows.length +
    splitRows.length +
    otherRows.length;

  // Counted over the rows on screen, so the strip at the top says the same
  // thing as the tables under it — see dayTally for what the account filter
  // does to "สลิป" and "ส่วนต่าง", which used to sit here counting a whole
  // day beside a list showing one account's share of it.
  const tally = dayTally(statementRows);
  const narrowed = branch !== "" || searching;

  // Whether each section is showing its rows, and the one click that changes
  // it. The rows a search found are what let a folded section open itself —
  // see sectionOpen for the trap that avoids.
  const isOpen = (key: SectionKey, matches = 0) =>
    sectionOpen(
      { clicked: clicked[key], searching, matches },
      SECTION_OPEN_BY_DEFAULT[key]
    );
  const toggle = (key: SectionKey, matches = 0) =>
    setClicked((prev) => ({ ...prev, [key]: !isOpen(key, matches) }));

  // One set of handlers for all three tables that offer them, so a payment
  // can be recorded from whichever view a person happened to be reading — and
  // so only one form is ever open, wherever it was opened from.
  const actions = {
    acting,
    open: openForm,
    close: closeForm,
    memberNumber: actMemberNumber,
    setMemberNumber: setActMemberNumber,
    memberName: actMemberName,
    setMemberName: setActMemberName,
    category: actCategory,
    setCategory: setActCategory,
    note: actNote,
    setNote: setActNote,
    saving,
    onBind: bindAccount,
    onRecord: recordDeposit,
    onBulkRecord: bulkRecordDeposits,
    onUnmark: unmarkMemberMoney,
    onSplit: (lineId: string) => setSplittingId(lineId),
  };

  return (
    <section className="bg-white rounded-lg border border-slate-200">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="font-semibold">เงินเข้าประจำวัน (เทียบกับสลิปที่ส่งมาทางไลน์)</h2>
        <PanelHelp summary="เทียบเงินที่เข้าบัญชีสหกรณ์วันนั้น กับสลิปที่สมาชิกส่งเข้าบอท เพื่อจับสลิปที่ไม่มีเงินเข้าจริง และเงินที่เข้ามาโดยไม่มีใครแจ้ง">
          <p>
            <strong>อัปโหลด Statement ได้ที่นี่เลย ไม่ต้องสร้างรอบเก็บไม่ได้</strong>{" "}
            (ไฟล์ที่เคยอัปในแท็บ "เทียบ Statement" ก็ใช้ได้ ไม่ต้องอัปซ้ำ)
          </p>
          <p className="text-amber-700">
            ⚠️ ช่อง <strong>"จับคู่จาก"</strong> บอกว่าคู่นั้นเชื่อได้แค่ไหน —
            <strong>เลขบัญชีตรง</strong> กับ <strong>บัญชีในสลิปตรง</strong> แน่นอนเกือบ 100%,
            <strong>เวลาใกล้กัน</strong> ค่อนข้างแน่, ส่วน <strong>ยอดตรงเท่านั้น</strong> คือ
            <strong>เดา</strong> — วันที่มีคนโอนยอดเท่ากันหลายคนอาจสลับคู่กันได้
            ให้ถือว่าเป็นรายการให้ไล่ดู ไม่ใช่คำตอบสุดท้าย
          </p>
          <p className="text-slate-500">
            สลิปที่บอทบันทึก<strong>ตั้งแต่ 7 ก.ย. 69 เป็นต้นไป</strong>จะเก็บเวลาที่โอนและเลขบัญชีผู้โอน
            (เท่าที่สลิปแสดง) ไว้ด้วย — รายการเก่ากว่านั้นยังมีแค่วันที่กับยอดเงิน จึงจับคู่ได้แค่ "ยอดตรงเท่านั้น"
          </p>
        </PanelHelp>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-100 text-sm">
        <button
          onClick={() => shiftRange(-1)}
          className="px-2 py-1.5 border border-slate-200 rounded-md hover:bg-slate-50"
        >
          ← วันก่อน
        </button>
        <DateField
          value={from}
          onChange={(value) => {
            if (!value) return;
            setFrom(value);
            // Dragging the start past the end is a mistake, not a request for
            // an empty range — carry the end along instead of erroring.
            if (value > to) setTo(value);
          }}
          className="border border-slate-300 rounded-md px-3 py-1.5"
        />
        <span className="text-slate-400">ถึง</span>
        <DateField
          value={to}
          onChange={(value) => {
            if (!value) return;
            setTo(value);
            if (value < from) setFrom(value);
          }}
          className="border border-slate-300 rounded-md px-3 py-1.5"
        />
        <button
          onClick={() => shiftRange(1)}
          className="px-2 py-1.5 border border-slate-200 rounded-md hover:bg-slate-50"
        >
          วันถัดไป →
        </button>
        <button
          onClick={() => {
            setFrom(todayISO());
            setTo(todayISO());
          }}
          className="px-3 py-1.5 border border-slate-200 rounded-md hover:bg-slate-50"
        >
          วันนี้
        </button>
        <button
          onClick={() => {
            setFrom(shiftDay(todayISO(), -6));
            setTo(todayISO());
          }}
          className="px-3 py-1.5 border border-slate-200 rounded-md hover:bg-slate-50"
        >
          7 วันล่าสุด
        </button>
        <span className="ml-auto text-slate-500">
          {formatStatementDate(`${from}T00:00:00.000Z`)}
          {from !== to && ` – ${formatStatementDate(`${to}T00:00:00.000Z`)}`}
        </span>
      </div>

      {/* One box over the whole screen. Somebody looking for a payment does
          not know which of the five conclusions it landed under — not knowing
          is usually why they are looking. */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-slate-100 text-sm">
        <select
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          className="border border-slate-300 rounded-md px-2 py-1.5 bg-white"
        >
          <option value="">ทุกบัญชี</option>
          {branches.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นทุกหัวข้อ: ชื่อ, เลขสมาชิก, ยอด, เลขบัญชี, วันที่, เวลา, รหัส…"
          className="border border-slate-300 rounded-md px-3 py-1.5 w-full sm:w-[26rem]"
        />
        {searching && (
          <>
            <span className="text-slate-500">
              เจอ <strong className="num text-slate-900">{totalHits}</strong> รายการทุกหัวข้อรวมกัน
            </span>
            <button onClick={() => setSearch("")} className="text-slate-500 hover:underline">
              ล้าง
            </button>
          </>
        )}
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
          อัปทับไฟล์เดิมได้ ไม่นับเงินซ้ำ · อัปกี่วันก็ได้ในไฟล์เดียว ·{" "}
          <strong className="text-amber-700">เลือกบัญชีให้ตรงกับไฟล์</strong>
        </span>
        <button
          onClick={runBackfillBridge}
          disabled={backfilling}
          title='ไล่หารายการที่เคยกดบันทึกเป็น "ชำระเก็บไม่ได้รายเดือน" ไว้ก่อนหน้า แต่รอบยังไม่เห็น แล้วเชื่อมให้ — ไม่กระทบรายการที่เชื่อมไปแล้ว'
          className="ml-auto text-xs text-slate-500 hover:underline disabled:opacity-40"
        >
          {backfilling ? "กำลังเชื่อม…" : "🔄 เชื่อมรายการเก่าที่ตกค้างกับรอบ"}
        </button>
        <button
          onClick={runFixBridgeRounds}
          disabled={fixingRounds}
          title="แก้รายการที่เชื่อมเข้ารอบผิดเดือน (เช่น ยอดเดือนก่อนถูกนับเป็นยอดของเดือนนี้) ให้ย้ายไปรอบที่ถูกต้องตามวันที่โอนจริง — ไม่แตะไฟล์ Statement ที่อัปไว้เลย"
          className="text-xs text-slate-500 hover:underline disabled:opacity-40"
        >
          {fixingRounds ? "กำลังแก้…" : "🩹 แก้รายการที่เชื่อมผิดรอบ"}
        </button>
        <button
          onClick={() => {
            setShowUploads((v) => !v);
            if (!showUploads) fetchUploads();
          }}
          className="text-xs text-slate-500 hover:underline"
        >
          {showUploads ? "▾" : "▸"} ไฟล์ Statement ที่อัปไว้
        </button>
      </div>
      {backfillNotice && (
        <p className="px-4 py-2 text-sm text-sky-800 bg-sky-50">{backfillNotice}</p>
      )}
      {fixRoundsNotice && (
        <p className="px-4 py-2 text-sm text-amber-900 bg-amber-50">{fixRoundsNotice}</p>
      )}

      {/* The one action on this page that repeating cannot undo, so the only
          one that needs a list and a way out. See lib/statementUploads.ts. */}
      {showUploads && (
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
          <p className="text-xs text-slate-500 mb-2">
            ทุกไฟล์ที่เคยอัปไว้ แยกตามบัญชี — ลบได้ถ้าอัปผิดบัญชี
            (ลบเฉพาะบรรทัดในไฟล์นั้น ไม่กระทบไฟล์อื่น) ·
            ถ้ามีรายการที่บันทึกไว้จากบรรทัดในไฟล์ ระบบจะไม่ยอมลบจนกว่าจะลบรายการนั้นก่อน
          </p>
          {uploads === null ? (
            <p className="text-sm text-slate-400">กำลังโหลด…</p>
          ) : uploads.length === 0 ? (
            <p className="text-sm text-slate-400">— ยังไม่มีไฟล์ —</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-slate-500 text-left text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-2 py-1.5 font-semibold">บัญชี</th>
                    <th className="px-2 py-1.5 font-semibold">ไฟล์</th>
                    <th className="px-2 py-1.5 font-semibold">ช่วงวันที่</th>
                    <th className="px-2 py-1.5 font-semibold text-right">บรรทัด</th>
                    <th className="px-2 py-1.5 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {uploads.map((upload) => {
                    const twin = overlapsAnotherAccount(upload, uploads);
                    return (
                      <tr
                        key={`${upload.account}-${upload.sourceFile ?? ""}`}
                        className={`border-t border-slate-200 ${twin ? "bg-amber-50" : ""}`}
                      >
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <span className="num">{upload.account}</span> {upload.branch}
                        </td>
                        <td className="px-2 py-1.5">
                          {upload.sourceFile ?? (
                            <span className="text-slate-400">(ไม่ทราบชื่อไฟล์)</span>
                          )}
                          {/* Two accounts holding the same number of lines
                              over the same days is what one file loaded
                              twice looks like from here. */}
                          {twin && (
                            <span
                              className="text-amber-800 text-xs"
                              title="อีกบัญชีหนึ่งมีไฟล์ที่ครอบคลุมวันเดียวกันและจำนวนบรรทัดเท่ากันพอดี — น่าจะเป็นไฟล์เดียวกันที่อัปผิดบัญชี ตรวจสอบก่อนลบ"
                            >
                              {" "}
                              ⚠️ ซ้ำกับอีกบัญชี
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">
                          {formatStatementDate(upload.from)}
                          {upload.from !== upload.to && ` – ${formatStatementDate(upload.to)}`}
                        </td>
                        <td className="px-2 py-1.5 num text-right">{upload.lines}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-right">
                          <button
                            onClick={() => removeUpload(upload)}
                            disabled={saving}
                            className="text-xs text-red-700 hover:underline disabled:opacity-40"
                          >
                            ลบไฟล์นี้
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {uploadNotice && (
        <p className="px-4 py-2 text-sm text-green-700 bg-green-50">{uploadNotice}</p>
      )}

      {splittingId && (
        <LineSplitDialog
          lineId={splittingId}
          onClose={() => setSplittingId(null)}
          onSaved={async (message) => {
            setSplittingId(null);
            setError(null);
            setActionNotice(message);
            await fetchDay(from, to);
          }}
        />
      )}
      {actionNotice && (
        <p className="px-4 py-2 text-sm text-green-700 bg-green-50">{actionNotice}</p>
      )}

      {/* What the daily page cannot do. Kept apart from the green notice
          because it is not a failure — the thing asked for was done, and this
          is the next step nobody would guess at. */}
      {roundNote && (
        <p className="px-4 py-2 text-sm bg-amber-50 text-amber-900">ℹ️ {roundNote}</p>
      )}

      {/* The half a recording does not do. Said here rather than left to be
          discovered when the same account arrives again as money nobody can
          name. */}
      {bindOffer && (
        <p className="px-4 py-2 text-sm bg-sky-50 text-sky-900 flex flex-wrap items-center gap-2">
          <span>
            เลขบัญชี <strong className="num">{bindOffer.accountNumber}</strong>{" "}
            ยังไม่ได้ผูกกับใคร — บันทึกรายการไม่ได้จำเลขบัญชีไว้ให้
            ครั้งหน้าที่โอนมาจากบัญชีนี้ระบบจะยังไม่รู้ว่าเป็นใคร
          </span>
          <button
            onClick={() => bindAccount(bindOffer.accountNumber, bindOffer.memberNumber)}
            disabled={saving}
            className="px-2 py-1 rounded bg-sky-700 text-white text-xs disabled:opacity-40"
          >
            จำไว้ว่าเป็นของ {bindOffer.memberNumber} {bindOffer.memberName ?? ""}
          </button>
          <button
            onClick={() => setBindOffer(null)}
            className="text-xs text-sky-700 hover:underline"
          >
            ไม่ต้อง
          </button>
        </p>
      )}

      {error && <p className="px-4 py-3 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-slate-500 text-sm py-10 text-center">กำลังโหลด…</p>
      ) : !data ? null : !data.loaded ? (
        <p className="text-slate-500 text-sm py-10 text-center px-4">
          ยังไม่มี Statement ที่ครอบคลุม{from === to ? "วันนี้" : "ช่วงที่เลือก"} —
          อัปโหลดไฟล์ได้ที่แถบด้านบน
          <br />
          <span className="text-xs text-slate-400">
            (ต่างจาก "ไม่มีเงินเข้า" — ระบบยังไม่มีข้อมูลของช่วงนี้เลย)
          </span>
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4 px-4 py-2.5 border-b border-slate-100 text-sm bg-slate-50">
            <span className="text-slate-500">
              เงินเข้า <strong className="num text-slate-900">{tally.depositCount}</strong> รายการ{" "}
              <Money value={tally.depositAmount} className="font-semibold text-green-700" />
            </span>
            <span className="text-slate-500">
              ตรงกับสลิป <strong className="num text-slate-900">{tally.matchedCount}</strong>{" "}
              <Money value={tally.matchedAmount} className="font-semibold" />
            </span>
            <span className="text-slate-500">
              ยังไม่มีสลิป{" "}
              <strong className="num text-slate-900">{tally.unmatchedCount}</strong>{" "}
              <Money
                value={tally.unmatchedAmount}
                className={`font-semibold ${
                  tally.unmatchedCount === 0 ? "text-slate-900" : "text-amber-700"
                }`}
              />
            </span>
            {/* Said out loud, because a total that changes when a filter is
                set is only readable if the page admits which one it is
                counting. */}
            {narrowed && (
              <span className="text-xs text-slate-400">
                (เฉพาะ
                {branch ? `บัญชี ${branch}` : ""}
                {branch && searching ? " · " : ""}
                {searching ? "ที่ค้นหา" : ""})
              </span>
            )}
            {/* Seven sections is too many to fold one at a time when the
                answer is "show me everything" or "get all of it out of the
                way". Pushed to the right so it reads as a control over the
                page rather than as part of the day's figures. */}
            <span className="ml-auto flex items-center gap-2 text-xs">
              <button
                onClick={() => setClicked(allSections(true))}
                className="text-slate-500 hover:underline"
              >
                ขยายทั้งหมด
              </button>
              <span className="text-slate-300">·</span>
              <button
                onClick={() => setClicked(allSections(false))}
                className="text-slate-500 hover:underline"
              >
                ย่อทั้งหมด
              </button>
            </span>
          </div>

          {/* One account in the range is not a reason to say nothing. It
              usually means the other account's statement has not been
              uploaded this far, and every total above is then one account's
              money reading as the whole day's. */}
          {perAccount.length === 1 && absentBranches.length > 0 && (
            <div className="px-4 py-2 border-t border-slate-100 text-sm bg-amber-50 text-amber-800">
              ⚠️ ช่วงนี้มีรายการเฉพาะบัญชี <strong>{perAccount[0].branch}</strong> —{" "}
              <strong>{absentBranches.join(" และ ")}</strong> ไม่มีรายการเลย
              <span className="text-xs">
                {" "}
                (Statement ของบัญชีนั้นอาจยังไม่ครอบคลุมช่วงนี้ — ตัวเลขด้านบนจึงเป็นของบัญชีเดียว)
              </span>
            </div>
          )}

          {/* The two accounts are reconciled separately, against two
              different statements, so the day is reported per account before
              it is reported as a whole. */}
          {perAccount.length > 1 && (
            <div className="px-4 py-3 border-t border-slate-100">
              <h3 className="text-sm font-semibold">📊 แยกตามบัญชีสหกรณ์</h3>
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-sm">
                  <thead className="text-slate-500 text-left text-xs uppercase tracking-wide">
                    <tr>
                      <th className="px-2 py-1.5 font-semibold">บัญชี</th>
                      <th className="px-2 py-1.5 font-semibold text-right">เงินเข้า</th>
                      <th className="px-2 py-1.5 font-semibold text-right">ยอดรวม</th>
                      <th className="px-2 py-1.5 font-semibold text-right">ตรงกับสลิป</th>
                      <th className="px-2 py-1.5 font-semibold text-right">ยังไม่มีสลิป</th>
                      <th className="px-2 py-1.5 font-semibold text-right">รายการอื่น</th>
                      <th className="px-2 py-1.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {perAccount.map((a) => (
                      <tr key={a.branch} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-2 py-1.5 font-medium whitespace-nowrap">{a.branch}</td>
                        <td className="px-2 py-1.5 num text-right">{a.depositCount}</td>
                        <td className="px-2 py-1.5 text-right">
                          <Money value={a.depositAmount} className="font-semibold text-green-700" />
                        </td>
                        <td className="px-2 py-1.5 num text-right text-slate-500">
                          {a.matchedCount}
                        </td>
                        {/* The number that is actually somebody's job today. */}
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          <span className={a.unclaimedCount > 0 ? "text-amber-700" : "text-slate-400"}>
                            <span className="num">{a.unclaimedCount}</span>
                            {a.unclaimedCount > 0 && (
                              <span className="text-xs"> · <Money value={a.unclaimedAmount} /></span>
                            )}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 num text-right text-slate-400">{a.otherCount}</td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap">
                          <button
                            onClick={() => setBranch(branch === a.branch ? "" : a.branch)}
                            className="text-xs text-slate-600 hover:underline"
                          >
                            {branch === a.branch ? "เลิกกรอง" : "ดูเฉพาะบัญชีนี้"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                สลิปไม่ได้แยกตามบัญชี — สลิปเป็นของสมาชิก ไม่ใช่ของบัญชี และ
                <strong>สลิปที่ยังไม่เจอเงินเข้าก็ยังไม่มีบัญชีปลายทาง</strong> นั่นคือสาเหตุที่มันยังจับคู่ไม่ได้
              </p>
            </div>
          )}

          {/* The oldest question of the lot, and the one the tab did not
              answer: how much came in, how much went out, what is it worth
              now, and what were people paying for. Everything above sorts the
              day by whether somebody still has work to do; this adds it up.

              Marked print-report so this section, and nothing else on the
              page, is what reaches paper. */}
          <div className="px-4 py-3 border-t border-slate-100 print-report">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => toggle("report")}
                aria-expanded={isOpen("report")}
                className="text-sm text-slate-700 hover:underline font-medium no-print"
              >
                {isOpen("report") ? "▾" : "▸"} 🧾 สรุปยอดเงินเข้า-เงินออก
              </button>
              {isOpen("report") && (
                <button
                  onClick={() => window.print()}
                  className="text-xs border border-slate-300 rounded-md px-2 py-1 hover:bg-slate-50 no-print"
                >
                  🖨️ พิมพ์รายงาน
                </button>
              )}
            </div>

            {isOpen("report") && (
              <div className="mt-3">
                {/* Only on paper: on screen the date and the account are in
                    the boxes above, but a printed page has to say what it is
                    a report of, filters and all. */}
                <div className="hidden print:block mb-3">
                  <h2 className="font-semibold text-base">
                    สหกรณ์ออมทรัพย์ครูหนองคาย-บึงกาฬ — สรุปยอดเงินเข้า-เงินออก
                  </h2>
                  <p className="text-xs text-slate-600">
                    {from === to
                      ? formatStatementDate(`${from}T00:00:00.000Z`)
                      : `${formatStatementDate(`${from}T00:00:00.000Z`)} ถึง ${formatStatementDate(
                          `${to}T00:00:00.000Z`
                        )}`}
                    {branch ? ` · เฉพาะบัญชี ${branch}` : " · ทุกบัญชี"}
                    {search ? ` · กรองด้วยคำค้น "${search}"` : ""}
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-slate-500 text-left text-xs uppercase tracking-wide">
                      <tr>
                        <th className="px-2 py-1.5 font-semibold">บัญชี</th>
                        <th className="px-2 py-1.5 font-semibold text-right">เงินเข้า</th>
                        <th className="px-2 py-1.5 font-semibold text-right">รวมเงินเข้า</th>
                        <th className="px-2 py-1.5 font-semibold text-right">เงินออก</th>
                        <th className="px-2 py-1.5 font-semibold text-right">รวมเงินออก</th>
                        <th className="px-2 py-1.5 font-semibold text-right">สุทธิ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flowRows.map((flow) => (
                        <tr key={flow.branch} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 font-medium whitespace-nowrap">{flow.branch}</td>
                          <td className="px-2 py-1.5 num text-right text-slate-500">
                            {flow.inCount}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <Money value={flow.inAmount} className="text-green-700 font-medium" />
                          </td>
                          <td className="px-2 py-1.5 num text-right text-slate-500">
                            {flow.outCount}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <Money value={flow.outAmount} className="text-rose-700" />
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <Money
                              value={flow.net}
                              className={flow.net < 0 ? "text-rose-700" : "font-semibold"}
                            />
                          </td>
                        </tr>
                      ))}
                      {/* Computed from the lines, not summed from the rows
                          above — a line whose account was never read still
                          belongs in the day's total. */}
                      <tr className="border-t-2 border-slate-300 bg-slate-50">
                        <td className="px-2 py-1.5 font-semibold">รวมทุกบัญชี</td>
                        <td className="px-2 py-1.5 num text-right text-slate-500">
                          {flowAll.inCount}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <Money value={flowAll.inAmount} className="text-green-700 font-semibold" />
                        </td>
                        <td className="px-2 py-1.5 num text-right text-slate-500">
                          {flowAll.outCount}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <Money value={flowAll.outAmount} className="text-rose-700 font-semibold" />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <Money
                            value={flowAll.net}
                            className={flowAll.net < 0 ? "text-rose-700 font-semibold" : "font-semibold"}
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <h3 className="text-sm font-semibold mt-4">เงินเข้าแยกตามประเภทรายการ</h3>
                <p className="text-xs text-slate-500">
                  ประเภทมาจากสลิปที่จับคู่กับบรรทัดนั้นได้แล้วเท่านั้น — สเตทเมนต์บอกแค่ว่าเงินเข้าเท่าไร
                  ไม่เคยบอกว่าเข้ามาทำอะไร
                </p>
                <div className="overflow-x-auto mt-2">
                  <table className="w-full text-sm">
                    <thead className="text-slate-500 text-left text-xs uppercase tracking-wide">
                      <tr>
                        <th className="px-2 py-1.5 font-semibold">ทำรายการ</th>
                        <th className="px-2 py-1.5 font-semibold text-right">จำนวน</th>
                        <th className="px-2 py-1.5 font-semibold text-right">ยอดรวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      {categories.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-2 py-4 text-center text-slate-500">
                            ไม่มีเงินเข้าในช่วงที่เลือก
                          </td>
                        </tr>
                      ) : (
                        categories.map((entry) => (
                          <tr key={entry.category} className="border-t border-slate-100">
                            <td className="px-2 py-1.5">{entry.category}</td>
                            <td className="px-2 py-1.5 num text-right text-slate-500">
                              {entry.count}
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <Money value={entry.amount} className="font-medium" />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <h3 className="text-sm font-semibold mt-4">
                  รายการทั้งหมด ({statementRows.length} รายการ)
                </h3>
                <div className="overflow-x-auto mt-2">
                  <StatementTable
                    rows={statementRows}
                    showDate={from !== to}
                    actions={actions}
                    scope="report"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Placed before the findings, because the first question a person
              checking the bank's own printout asks is "is everything here?" —
              and the sections below, sorted by conclusion and half of them
              collapsed, cannot answer it. */}
          <div className="px-4 py-3 border-t border-slate-100">
            <button
              onClick={() => toggle("statement", statementRows.length)}
              aria-expanded={isOpen("statement", statementRows.length)}
              className="text-sm text-slate-700 hover:underline font-medium"
            >
              {isOpen("statement", statementRows.length) ? "▾" : "▸"} 📄 รายการทั้งหมดในสเตทเมนต์
              {from === to ? "วันนี้" : "ช่วงนี้"} (
              {countLabel(statementRows.length, data.statement.length, "รายการ")})
            </button>
            <p className="text-xs text-slate-500 mt-1">
              ทุกบรรทัดในช่วงที่เลือก เรียงตามเวลาแบบเดียวกับไฟล์ของธนาคาร พร้อมบอกว่าแต่ละบรรทัด
              ตกอยู่ในกลุ่มไหนด้านล่าง — ใช้ไล่ทีละบรรทัดกับสเตทเมนต์ที่ปริ้นมาได้เลย
              <strong>
                {" "}
                จำนวนนี้คือจำนวนบรรทัดในไฟล์ทั้งหมด ไม่มีรายการไหนหายไป
              </strong>{" "}
              (กลุ่มด้านล่างแบ่งตามข้อสรุป บางกลุ่มพับไว้ เลยดูเหมือนมีน้อยกว่าความเป็นจริง)
            </p>
            {isOpen("statement", statementRows.length) &&
              /* Said plainly rather than shown as an empty table: "no results"
                 and "nothing in the file" look identical otherwise, and only
                 one of them is fixed by clearing the box. */
              (searching && statementRows.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">
                  ไม่มีบรรทัดไหนตรงกับ &ldquo;{search}&rdquo; ในช่วงวันที่เลือก —
                  ลองขยายช่วงวันที่ หรือค้นด้วยคำที่สั้นลง
                </p>
              ) : (
                <div className="overflow-x-auto mt-2">
                  <StatementTable
                    rows={statementRows}
                    showDate={from !== to}
                    actions={actions}
                  />
                </div>
              ))}
          </div>

          <Section
            title={`✅ ตรงกัน (${countLabel(matchedRows.length, data.matched.length, "รายการ")})`}
            tone="text-green-800"
            note={
              "เงินเข้าและสลิปคู่กันได้ — ไม่ต้องทำอะไร · " +
              'กด "ดูสลิป" เพื่อตรวจคู่ที่ยังไม่แน่ใจได้ โดยเฉพาะแถวที่จับคู่จาก "ยอดตรงเท่านั้น"' +
              " · พับไว้ให้เพราะกลุ่มนี้ไม่มีอะไรต้องทำและมักยาวที่สุดในหน้า"
            }
            empty={matchedRows.length === 0}
            open={isOpen("matched", matchedRows.length)}
            onToggle={() => toggle("matched", matchedRows.length)}
          >
            <table className="w-full text-sm">
              <thead className="text-slate-500 text-left text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-2 py-1.5 font-semibold">{from !== to ? "วันที่ / เวลา" : "เวลา"}</th>
                  <th className="px-2 py-1.5 font-semibold text-right">ยอด</th>
                  <th className="px-2 py-1.5 font-semibold">ผู้โอน</th>
                  <th className="px-2 py-1.5 font-semibold">ช่องทาง</th>
                  <th className="px-2 py-1.5 font-semibold">สลิปแจ้งว่า</th>
                  <th className="px-2 py-1.5 font-semibold">จับคู่จาก</th>
                  <th className="px-2 py-1.5 font-semibold">สลิป</th>
                </tr>
              </thead>
              <tbody>
                {matchedRows.map(({ deposit, slip, basis, dayApart, minutesApart }) => (
                  <tr key={deposit.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <Clock iso={deposit.postedAt} withDate={from !== to} />
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
            title={`⚠️ มีสลิปแต่ไม่เจอเงินเข้า (${countLabel(
              unmatchedSlips.length,
              data.slipsWithoutMoney.length,
              "ใบ"
            )})`}
            tone="text-red-700"
            note="สมาชิกส่งสลิปมาแต่หาเงินก้อนที่ตรงกันในบัญชีไม่เจอ — อาจโอนเข้าบัญชีอื่น สลิปซ้ำ หรือสลิปไม่จริง ควรตรวจก่อน"
            empty={data.slipsWithoutMoney.length === 0}
            open={isOpen("slipsWithoutMoney", unmatchedSlips.length)}
            onToggle={() => toggle("slipsWithoutMoney", unmatchedSlips.length)}
          >
            <SlipTable slips={unmatchedSlips} />
          </Section>

          {/* Split because these two are not the same job. On a busy day a
              few hundred members transfer without ever telling the bot, and
              that is normal — the ones worth a person's time are the payments
              nobody can even put a name to. Keeping them in one list buried
              the short list under the long one. */}
          <Section
            title={`❓ เงินเข้าที่ไม่รู้ว่าใครโอน (${countLabel(
              unknownRows.length,
              unknownPayer.length,
              "รายการ"
            )})`}
            tone="text-amber-800"
            note={
              "เลขบัญชีผู้โอนไม่ตรงกับใครเลย ทั้งในทะเบียนเลขบัญชีและรายชื่อหักไม่ได้ทุกรอบ — " +
              "เงินเข้ามาจริงแต่ยังไม่รู้ว่าของใคร กลุ่มนี้คือที่ต้องตามหา · " +
              'พอรู้แล้วบันทึกได้ตรงนี้เลย: "ระบุเจ้าของ" = จำเลขบัญชีไว้ใช้ครั้งต่อไป, ' +
              '"บันทึกรายการ" = ลงเป็นรายการของสมาชิกเหมือนสลิปที่ส่งทางไลน์'
            }
            empty={unknownPayer.length === 0}
            open={isOpen("unknownPayer", unknownRows.length)}
            onToggle={() => toggle("unknownPayer", unknownRows.length)}
          >
            <DepositTable deposits={unknownRows} showDate={from !== to} actions={actions} />
          </Section>

          {knownPayer.length > 0 && (
            <Section
              title={`เงินเข้าที่รู้ว่าใครโอน แต่ไม่ได้ส่งสลิป (${countLabel(
                knownRows.length,
                knownPayer.length,
                "รายการ"
              )})`}
              tone="text-slate-600"
              note={
                'รู้เจ้าของจากเลขบัญชีแล้ว แค่ไม่ได้ส่งสลิปเข้าบอท — ปกติเป็นการจ่ายค่าหักไม่ได้ที่แท็บ "เทียบ Statement" จับคู่ให้อยู่แล้ว ไม่ต้องทำอะไรเพิ่ม · ถ้าอยากลงเป็นรายการของสมาชิกด้วย กด "บันทึกรายการ" ได้ที่แถวนั้น — เลขสมาชิกใส่ให้อัตโนมัติแล้ว เหลือแค่เลือกว่าจ่ายเป็นอะไร'
              }
              empty={false}
              open={isOpen("knownPayer", knownRows.length)}
              onToggle={() => toggle("knownPayer", knownRows.length)}
            >
              <DepositTable deposits={knownRows} showDate={from !== to} actions={actions} />
            </Section>
          )}

          {(data.splitDeposits ?? []).length > 0 && (
            <Section
              title={`🏢 แบ่งให้สมาชิกหลายคนแล้ว (${countLabel(
                splitRows.length,
                data.splitDeposits.length,
                "รายการ"
              )})`}
              tone="text-slate-600"
              note="ยอดที่หน่วยงานโอนมาก้อนเดียวแล้วเจ้าหน้าที่แบ่งให้สมาชิกแต่ละคน — แต่ละคนนับในรอบเทียบ Statement ของเดือนที่เงินเข้า และมีรายการของตัวเองในแถบธุรกรรม · แก้ยอด/เพิ่มคนได้ที่ &quot;แก้ไขการแบ่ง&quot; หรือ &quot;ยกเลิกการแบ่ง&quot; เพื่อกลับไปเป็นเงินที่ยังไม่มีเจ้าของ"
              empty={false}
              open={isOpen("splitDeposits", splitRows.length)}
              onToggle={() => toggle("splitDeposits", splitRows.length)}
            >
              <SplitTable
                rows={splitRows}
                showDate={from !== to}
                saving={saving}
                onEdit={(id) => setSplittingId(id)}
                onUndo={undoSplit}
              />
            </Section>
          )}

          {data.otherLines.length > 0 && (
            <Section
              title={`รายการอื่นในบัญชี${from === to ? "วันนี้" : "ช่วงนี้"} (${countLabel(
                otherRows.length,
                data.otherLines.length,
                "รายการ"
              )})`}
              tone="text-slate-600"
              note={
                'รายการที่ไม่ใช่สมาชิกโอนเข้ามา — เงินหน่วยงาน ฌาปนกิจ ค่าธรรมเนียม เงินโอนออก ไม่นับในการเทียบด้านบน แต่แสดงไว้ให้เห็น · ถ้าเจอเงินเข้าที่จริงๆ แล้วเป็นของสมาชิก กด "เป็นเงินสมาชิก" ที่แถวนั้นได้เลย ไม่ต้องรอเพิ่มรหัส — ระบบจะย้ายไปอยู่ในกลุ่ม "เงินเข้าที่ไม่รู้ว่าใครโอน" ให้บันทึกต่อ (ย้อนกลับได้ ถ้ายังไม่ได้บันทึกเป็นรายการ) · ถ้าเป็นรหัสที่เจอบ่อยและควรนับเป็นเงินสมาชิกทุกครั้ง บอกได้ จะเพิ่มให้ถาวร'
              }
              empty={false}
              open={isOpen("otherLines", otherRows.length)}
              onToggle={() => toggle("otherLines", otherRows.length)}
            >
              <OtherTable
                lines={otherRows}
                showDate={from !== to}
                onMark={markMemberMoney}
                saving={saving}
                unitForm={unitForm}
                setUnitForm={setUnitForm}
                onAddUnit={addUnitFromLine}
              />
            </Section>
          )}
        </>
      )}
    </section>
  );
}

// The day in the bank's order, with the conclusion the tab reached about each
// line. See lib/statementDayView.ts — the sections above are sorted by
// conclusion, which is what makes a twenty-line day look like a six-line one.
const StatusTag = ({ status }: { status: DailyStatementRow["status"] }) => {
  const tone =
    status === "matched"
      ? "text-green-700"
      : status === "unknownPayer"
        ? "text-amber-800"
        : status === "knownPayer"
          ? "text-sky-700"
          : "text-slate-400";
  return <span className={`text-xs ${tone}`}>{STATUS_LABELS[status]}</span>;
};

// Who a statement line belongs to: the name on top, and beneath it the unit
// and member number that say which office to contact and which record to open.
// A number with no name means the account directory recognised the payer but
// the roster has no row for that number — worth seeing as it stands rather
// than blanking the cell.
const Member = ({
  name,
  number,
  unitName,
}: {
  name: string | null;
  number: string | null;
  unitName: string | null;
}) => {
  if (!name && !number) return <span className="text-slate-300">—</span>;
  const below = [unitName, number].filter(Boolean).join(" · ");
  return (
    <span className="block leading-tight">
      <span className="block">{name ?? <span className="text-slate-400">ไม่พบในทะเบียน</span>}</span>
      {below && <span className="num block text-xs text-slate-400">{below}</span>}
    </span>
  );
};

// The category to start the บันทึก form with, only where the row already
// told staff what this payment is for. "settled" is the round's own match —
// as sure as this view gets. "exact" is an amount landing exactly on what is
// owed, which the row itself already reads as "น่าจะเป็นการชำระเก็บไม่ได้
// รายเดือน". "short"/"over" stay unprefilled: there the amount does not
// actually match, so the row is a question for a person, not an answer.
const strongDeductionCategory = (deduction: DeductionHint | null): string | null =>
  deduction && (deduction.match === "settled" || deduction.match === "exact")
    ? DEDUCTION_CATEGORY
    : null;

// Eligible for the "เลือกแล้วบันทึกทีเดียว" toolbar: a known payer (the
// number a bulk POST would need) and a match strong enough to skip asking a
// person which category it is (see strongDeductionCategory) — the same bar a
// single row's บันทึก button already clears when it prefills the form.
const bulkEligible = (row: DailyStatementRow): boolean =>
  canRecordFromLine(row.status) &&
  !row.category &&
  row.memberNumber !== null &&
  strongDeductionCategory(row.deduction) !== null;

const StatementTable = ({
  rows,
  showDate = false,
  actions,
  scope = "statement",
}: {
  rows: DailyStatementRow[];
  // Only when the window spans more than one day: repeating the same date on
  // every row of a single day is noise in a column that is read constantly.
  showDate?: boolean;
  // Read-only without these.
  actions?: RecordActions;
  // The same day is on screen twice — in its own section and again inside the
  // report. Without telling them apart, clicking บันทึก in one opened the form
  // in both.
  scope?: "statement" | "report";
}) => {
  // Which rows are ticked for the bulk button, kept local to this table: the
  // same day appears twice on screen (its own section and the report), and a
  // tick made in one must not silently record from the other.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const eligibleRows = actions?.onBulkRecord ? rows.filter(bulkEligible) : [];
  const eligibleIds = new Set(eligibleRows.map((r) => r.id));
  // Filtered against what is actually still eligible, so a tick made before
  // the last refetch cannot linger and record a row that moved on (recorded
  // by someone else, or singly, in the meantime).
  const selectedEligible = [...selected].filter((id) => eligibleIds.has(id));
  const allSelected = eligibleRows.length > 0 && selectedEligible.length === eligibleRows.length;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(eligibleIds));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const runBulk = async () => {
    if (!actions?.onBulkRecord || selectedEligible.length === 0) return;
    const targets = eligibleRows
      .filter((r) => selectedEligible.includes(r.id))
      .map((r) => ({
        id: r.id,
        memberNumber: r.memberNumber as string,
        category: strongDeductionCategory(r.deduction) as string,
      }));
    setSelected(new Set());
    await actions.onBulkRecord(targets);
  };

  return (
  <>
    {eligibleRows.length > 0 && (
      <div className="flex items-center gap-3 px-2 py-1.5 text-xs text-slate-600 no-print">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            aria-label="เลือกทุกรายการที่ตรงกับเก็บไม่ได้"
          />
          เลือกทุกรายการที่ตรง ({eligibleRows.length})
        </label>
        {selectedEligible.length > 0 && (
          <button
            onClick={runBulk}
            disabled={actions?.saving}
            className="text-slate-900 font-medium hover:underline disabled:opacity-50"
            title={`บันทึกทุกรายการที่เลือกเป็น "${DEDUCTION_CATEGORY}" — เหมือนกดบันทึกทีละรายการ`}
          >
            บันทึกที่เลือก ({selectedEligible.length} รายการ)
          </button>
        )}
      </div>
    )}
    <table className="w-full text-sm">
    <thead className="text-slate-500 text-left text-xs uppercase tracking-wide">
      <tr>
        {eligibleRows.length > 0 && <th className="px-2 py-1.5 w-6 no-print" />}
        <th className="px-2 py-1.5 font-semibold">{showDate ? "วันที่ / เวลา" : "เวลา"}</th>
        <th className="px-2 py-1.5 font-semibold">รหัส</th>
        <th className="px-2 py-1.5 font-semibold">รายละเอียด</th>
        <th className="px-2 py-1.5 font-semibold text-right">ยอด</th>
        <th className="px-2 py-1.5 font-semibold text-right">คงเหลือ</th>
        <th className="px-2 py-1.5 font-semibold">บัญชี</th>
        <th className="px-2 py-1.5 font-semibold">สมาชิก</th>
        <th className="px-2 py-1.5 font-semibold">ทำรายการ</th>
        <th className="px-2 py-1.5 font-semibold">สถานะ</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => {
        const open =
          actions?.acting?.id === row.id && actions.acting.scope === scope
            ? actions.acting.kind
            : null;

        return (
        <Fragment key={row.id}>
        <tr className="border-t border-slate-100 hover:bg-slate-50">
          {eligibleRows.length > 0 && (
            <td className="px-2 py-1.5 no-print">
              {bulkEligible(row) && (
                <input
                  type="checkbox"
                  checked={selected.has(row.id)}
                  onChange={() => toggleOne(row.id)}
                  aria-label="เลือกรายการนี้"
                />
              )}
            </td>
          )}
          <td className="px-2 py-1.5 whitespace-nowrap">
            <ExactClock iso={row.postedAt} withDate={showDate} />
          </td>
          <td className="px-2 py-1.5 font-mono text-xs text-slate-500">{row.txnCode}</td>
          <td className="px-2 py-1.5">
            <StatementDetail description={row.description} />
          </td>
          <td className="px-2 py-1.5 text-right">
            <Money
              value={row.amount}
              className={row.status === "notMemberMoney" ? "text-slate-500" : "font-medium"}
            />
          </td>
          {/* The bank's running balance, which is what a person ties out
              against when they are checking the file line by line. */}
          <td className="px-2 py-1.5 num text-right text-slate-400 whitespace-nowrap">
            {row.balance === null ? "—" : formatAmount(row.balance)}
          </td>
          <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">{row.branch}</td>
          <td className="px-2 py-1.5 whitespace-nowrap">
            <Member
              name={row.memberName}
              number={row.memberNumber}
              unitName={row.unitName}
            />
          </td>
          {/* From the slip this line was paired with — the bank says an
              amount arrived, never what for. Failing that, what the month's
              หักไม่ได้ round already knows about this line: either its own
              matching already counted this exact transfer — settled if that
              member's deduction has actually failed (match === "settled"),
              merely counted if the round has not decided yet or payroll
              succeeded (match === "counted", so as not to call something
              "เก็บไม่ได้ … ชำระแล้ว" that was never เก็บไม่ได้ to begin with —
              looked up directly, see the route) — or, failing both, what this
              member still owes, offered as a suggestion to check rather than a
              statement from the member. The three read differently on
              purpose: settled is done, counted is only recorded, exact is a
              job still to do. */}
          <td className="px-2 py-1.5 text-slate-600">
            {row.category ? (
              row.category
            ) : row.deduction ? (
              <span
                // Capped and truncated rather than left to stretch the row:
                // "counted" and "over" can run long, and a wide column here
                // pushed the whole table into a horizontal scroll. The full
                // reason is always in the title tooltip below.
                className={
                  "inline-block max-w-[220px] truncate align-bottom " +
                  (row.deduction.match === "settled"
                    ? "text-emerald-700"
                    : row.deduction.match === "counted"
                      ? "text-sky-700"
                      : row.deduction.match === "exact"
                        ? "text-amber-700"
                        : "text-slate-500")
                }
                title={
                  row.deduction.match === "settled"
                    ? `รอบเก็บไม่ได้ ${row.deduction.label} นับเงินก้อนนี้เป็นการชำระของสมาชิกแล้ว — ` +
                      "จับคู่จากเลขบัญชีและยอดใน Statement โดยอัตโนมัติ ไม่ต้องโทรตาม"
                    : row.deduction.match === "counted"
                      ? `รอบ ${row.deduction.label} นับเงินก้อนนี้ไว้กับสมาชิกแล้ว จากเลขบัญชีและยอดใน Statement — ` +
                        (row.deduction.deductionResult === "awaiting"
                          ? "แต่ยังไม่รู้ผลว่าหน่วยงานหักเงินเดือนได้ไหม จึงยังไม่เรียกว่าเก็บไม่ได้"
                          : "แต่หน่วยงานหักเงินเดือนได้แล้ว จึงไม่ใช่เก็บไม่ได้") +
                        "\nเป็นข้อสังเกตให้ตรวจสอบ ไม่ใช่การบันทึก"
                      : `ค้างเก็บไม่ได้รอบ ${row.deduction.label}: ${formatAmount(
                          row.deduction.outstanding
                        )}` +
                        (row.deduction.match === "exact"
                          ? " — ยอดที่โอนมาตรงพอดี น่าจะเป็นการชำระเก็บไม่ได้รายเดือน"
                          : row.deduction.match === "short"
                            ? " — ยอดที่โอนมาน้อยกว่าที่ค้าง"
                            : " — ยอดที่โอนมามากกว่าที่ค้าง") +
                        "\nเป็นข้อสังเกตให้ตรวจสอบ ไม่ใช่การบันทึก"
                }
              >
                {describeDeductionHint(row.deduction)}
                {row.deduction.match !== "exact" &&
                  row.deduction.match !== "settled" &&
                  row.deduction.match !== "counted" && (
                    <span className="text-slate-400">
                      {" "}
                      ({formatAmount(row.deduction.outstanding)})
                    </span>
                  )}
              </span>
            ) : (
              <span className="text-slate-300">—</span>
            )}
            {/* The column names the job, so the job is offered in it. Before
                this, a line whose payer the directory already recognised
                could be read here and recorded nowhere: the unclaimed list
                carries the buttons and this money never reaches that list. */}
            {actions && canRecordFromLine(row.status) && !row.category && (
              <button
                onClick={() =>
                  actions.open(
                    { id: row.id, kind: "record", scope },
                    row.memberNumber,
                    strongDeductionCategory(row.deduction)
                  )
                }
                className="ml-2 text-xs text-slate-900 hover:underline no-print"
                title="บันทึกเงินก้อนนี้เป็นรายการของสมาชิก เหมือนที่สลิปทางไลน์ทำ — ยอดและวันที่ใช้ตามธนาคาร"
              >
                บันทึก
              </button>
            )}
          </td>
          <td className="px-2 py-1.5 whitespace-nowrap">
            <StatusTag status={row.status} />
          </td>
        </tr>

        {actions && open && (
          <tr className="bg-slate-50 border-t border-slate-100">
            <td colSpan={eligibleRows.length > 0 ? 10 : 9} className="px-3 py-2.5">
              <ActionForm
                actions={actions}
                mode={open}
                targetId={row.id}
                amount={row.amount}
                senderAccount={row.senderAccount}
              />
              <p className="text-xs text-slate-500 mt-2">
                ยอดและวันที่ใช้ตามที่ธนาคารบันทึกไว้ ไม่ต้องพิมพ์เอง ·
                ชื่อใส่เฉพาะตอนที่เลขสมาชิกยังไม่มีในทะเบียน · ถ้าไม่เข้าหมวดไหนเลย เลือก
                &ldquo;อื่นๆ&rdquo; แล้วเขียนว่าเป็นค่าอะไร — ถ้าบันทึกผิด ลบได้ที่แท็บ
                &ldquo;รายการ&rdquo;
              </p>
            </td>
          </tr>
        )}
        </Fragment>
        );
      })}
    </tbody>
  </table>
  </>
  );
};

// One finding, folded or not. The heading is the control: a whole page of
// stacked tables is only navigable if every one of them can be got out of the
// way, and the count stays on the header so a folded section still says how
// much is inside it.
//
// An empty section has nothing to fold, so it does not pretend to — the
// triangle would be a control that does nothing, and "— ไม่มี —" is already
// the whole answer.
const Section = ({
  title,
  tone,
  note,
  empty,
  open,
  onToggle,
  children,
}: {
  title: string;
  tone: string;
  note: string;
  empty: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) => (
  <div className="px-4 py-3 border-t border-slate-100">
    {empty ? (
      <h3 className={`text-sm font-semibold ${tone}`}>{title}</h3>
    ) : (
      <button
        onClick={onToggle}
        aria-expanded={open}
        className={`text-sm font-semibold text-left hover:underline ${tone}`}
      >
        {open ? "▾" : "▸"} {title}
      </button>
    )}
    <p className="text-xs text-slate-500 mt-1">{note}</p>
    {empty ? (
      <p className="text-sm text-slate-400 py-3">— ไม่มี —</p>
    ) : (
      open && <div className="overflow-x-auto mt-2">{children}</div>
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

// Which row has a form open, and which answer it is being given.
//
// `scope` is there because one bank line shows up in two tables — once under
// the finding it fell into, and once in the statement read in the bank's own
// order. Keyed by id alone, clicking บันทึก in one opened the form in both.
export interface ActingTarget {
  id: string;
  kind: "bind" | "record";
  // "deposits" — one of the findings lists. "statement" and "report" — the two
  // places the whole day is shown in the bank's own order.
  scope: "deposits" | "statement" | "report";
}

// What staff can do with a payment that has no slip behind it, and the form
// behind the buttons. Everything here is optional on a table: one renders
// read-only when no handlers are passed.
interface RecordActions {
  acting: ActingTarget | null;
  // Opens a form, clearing the last one. The member number is prefilled where
  // the row already knows it — on a line whose payer the directory
  // recognised, that number is on screen two columns away, and asking somebody
  // to retype it is asking them to mistype it. The category is prefilled
  // only where the row itself already said what the payment is for — see
  // openForm.
  open: (target: ActingTarget, memberNumber?: string | null, category?: string | null) => void;
  close: () => void;
  memberNumber: string;
  setMemberNumber: (value: string) => void;
  memberName: string;
  setMemberName: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  // Free text, and the only thing that says what an อื่นๆ payment was for.
  note: string;
  setNote: (value: string) => void;
  saving: boolean;
  onBind: (accountNumber: string, memberNumber?: string) => void;
  onRecord: (depositId: string) => void;
  // Records several lines in one go — the "เลือกแล้วบันทึกทีเดียว" toolbar in
  // StatementTable, offered only for lines it already judged eligible (see
  // strongDeductionCategory): a known payer and a match the round vouches
  // for, so nothing here needs a person's judgment call per row.
  onBulkRecord: (
    targets: { id: string; memberNumber: string; category: string }[]
  ) => Promise<void>;
  // Only ever called for a line a person marked as member money themselves,
  // which is also the only kind of row it is offered on.
  onUnmark: (lineId: string) => void;
  // Opens the dialog that divides one line among several members — a unit
  // paying for its people in a single transfer.
  onSplit?: (lineId: string) => void;
}

// The form itself, shared by both tables that offer it so the two cannot
// drift on what a recording asks for.
const ActionForm = ({
  actions,
  mode,
  targetId,
  amount,
  senderAccount,
  picks,
}: {
  actions: RecordActions;
  mode: "bind" | "record";
  targetId: string;
  amount: number;
  senderAccount: string | null;
  // A known unit's members, for its line the amount could not name: one
  // click fills the number. Closest amount first.
  picks?: { memberNumber: string; name: string | null; amount: number | null }[] | null;
}) => {
  const detailMissing = categoryNeedsDetail(actions.category) && !actions.note.trim();
  const ready =
    actions.memberNumber.trim() !== "" &&
    (mode === "bind" ? senderAccount !== null : actions.category !== "" && !detailMissing);
  const submit = () => {
    if (mode === "bind" && senderAccount) actions.onBind(senderAccount);
    else if (mode === "record") actions.onRecord(targetId);
  };

  const sortedPicks = [...(picks ?? [])].sort(
    (a, b) =>
      Math.abs((a.amount ?? Infinity) - amount) - Math.abs((b.amount ?? Infinity) - amount)
  );

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {mode === "record" && sortedPicks.length > 0 && (
        <div className="w-full flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-500">🏢 สมาชิกของหน่วยงานนี้:</span>
          {sortedPicks.map((p) => (
            <button
              key={p.memberNumber}
              type="button"
              onClick={() => actions.setMemberNumber(p.memberNumber)}
              className={`border rounded-full px-2 py-0.5 hover:bg-sky-50 ${
                actions.memberNumber.trim() === p.memberNumber
                  ? "border-sky-500 bg-sky-50 text-sky-800"
                  : "border-slate-300 text-slate-700"
              }`}
              title="เลือกสมาชิกคนนี้ — ยอดในวงเล็บคือยอดแจ้งหักเดือนนี้ หรือยอดที่หน่วยงานโอนให้ครั้งก่อน"
            >
              <span className="num">{p.memberNumber}</span> {p.name ?? ""}
              {p.amount != null && <span className="text-slate-400"> ({formatAmount(p.amount)})</span>}
            </button>
          ))}
        </div>
      )}
      <span className="text-slate-500">
        {mode === "bind"
          ? `เลขบัญชี ${senderAccount} เป็นของสมาชิกเลข`
          : `${formatAmount(amount)} นี้ เป็นเงินของสมาชิกเลข`}
      </span>
      <input
        value={actions.memberNumber}
        onChange={(e) => actions.setMemberNumber(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") actions.close();
          if (e.key === "Enter" && ready) submit();
        }}
        placeholder="เลขสมาชิก"
        autoFocus
        className="border border-slate-300 rounded px-2 py-1 w-40 bg-white"
      />
      {mode === "record" && (
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
            {STAFF_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {/* อื่นๆ on its own says nothing, so it brings its own question with
              it rather than filing a transaction nobody can read back. */}
          {categoryNeedsDetail(actions.category) && (
            <input
              value={actions.note}
              onChange={(e) => actions.setNote(e.target.value)}
              placeholder="ระบุว่าเป็นรายการอะไร"
              autoFocus
              title="เลือกอื่นๆ แล้วต้องเขียนด้วยว่าเงินก้อนนี้เป็นค่าอะไร ข้อความนี้จะไปอยู่ในรายละเอียดของรายการ"
              className="border border-amber-400 rounded px-2 py-1 w-56 bg-white"
            />
          )}
        </>
      )}
      <button
        onClick={submit}
        disabled={actions.saving || !ready}
        className="px-3 py-1 rounded bg-slate-900 text-white disabled:opacity-40"
      >
        {actions.saving ? "กำลังบันทึก…" : "บันทึก"}
      </button>
      <button onClick={actions.close} className="text-slate-500 hover:underline">
        ยกเลิก
      </button>
    </div>
  );
};

// What a search box matches in a divided line: the line itself, the unit's
// name, and every member it went to.
const splitHaystack = (row: DailySplitDepositRow) =>
  [
    formatStatementDate(row.postedAt),
    String(row.amount),
    formatAmount(row.amount),
    row.description,
    row.payerName ?? "",
    ...row.parts.flatMap((p) => [p.memberNumber, p.name ?? "", formatAmount(p.amount)]),
  ]
    .join(" ")
    .toLowerCase();

const SplitTable = ({
  rows,
  showDate,
  saving,
  onEdit,
  onUndo,
}: {
  rows: DailySplitDepositRow[];
  showDate: boolean;
  saving: boolean;
  onEdit: (id: string) => void;
  onUndo: (id: string) => void;
}) => (
  <table className="w-full text-sm">
    <thead className="text-slate-500 text-left text-xs uppercase tracking-wide">
      <tr>
        <th className="px-2 py-1.5 font-semibold">{showDate ? "วันที่ / เวลา" : "เวลา"}</th>
        <th className="px-2 py-1.5 font-semibold text-right">ยอด</th>
        <th className="px-2 py-1.5 font-semibold">หน่วยงาน</th>
        <th className="px-2 py-1.5 font-semibold">แบ่งให้</th>
        <th className="px-2 py-1.5 font-semibold">ทำอะไรได้</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <tr key={row.id} className="border-t border-slate-100 align-top hover:bg-slate-50">
          <td className="px-2 py-1.5 whitespace-nowrap">
            <Clock iso={row.postedAt} withDate={showDate} />
          </td>
          <td className="px-2 py-1.5 text-right">
            <Money value={row.amount} className="font-medium" />
          </td>
          <td className="px-2 py-1.5">
            <div>{row.payerName ?? "—"}</div>
            <div className="text-xs text-slate-400">
              {row.branch} · <StatementDetail description={row.description} />
            </div>
          </td>
          <td className="px-2 py-1.5">
            <ul className="space-y-0.5">
              {row.parts.map((p) => (
                <li key={p.memberNumber} className="flex gap-2">
                  <span className="num">{p.memberNumber}</span>
                  <span className="text-slate-600">{p.name ?? ""}</span>
                  <Money value={p.amount} className="ml-auto text-slate-700" />
                </li>
              ))}
            </ul>
            <div className="text-xs text-slate-400 mt-0.5">{row.parts.length} คน</div>
          </td>
          <td className="px-2 py-1.5 whitespace-nowrap">
            <span className="inline-flex items-center gap-3 text-xs">
              <button onClick={() => onEdit(row.id)} className="text-slate-900 hover:underline">
                แก้ไขการแบ่ง
              </button>
              <button
                onClick={() => onUndo(row.id)}
                disabled={saving}
                className="text-red-700 hover:underline disabled:opacity-40"
              >
                ยกเลิกการแบ่ง
              </button>
            </span>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

const DepositTable = ({
  deposits,
  actions,
  showDate = false,
}: {
  deposits: DailyDepositRow[];
  actions?: RecordActions;
  // Only when the window spans more than one day — see Clock.
  showDate?: boolean;
}) => (
  <table className="w-full text-sm">
    <thead className="text-slate-500 text-left text-xs uppercase tracking-wide">
      <tr>
        <th className="px-2 py-1.5 font-semibold">{showDate ? "วันที่ / เวลา" : "เวลา"}</th>
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
        const open =
          actions?.acting?.id === deposit.id && actions.acting.scope === "deposits"
            ? actions.acting.kind
            : null;
        const caveat = accountCaveat(deposit);

        return (
          <Fragment key={deposit.id}>
            <tr className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-2 py-1.5 whitespace-nowrap">
                <Clock iso={deposit.postedAt} withDate={showDate} />
              </td>
              <td className="px-2 py-1.5 text-right">
                <Money value={deposit.amount} className="font-medium" />
              </td>
              <td className="px-2 py-1.5">
                <Payer deposit={deposit} />
                {!deposit.memberNumber && deposit.suggestion && (
                  <span
                    className="block text-xs text-sky-700"
                    title="เดาจากยอด — สมาชิกคนเดียวในรอบที่ค้างยอดนี้พอดี ตรวจก่อนบันทึก บันทึกแล้วเดือนหน้าระบบจะจำยอดนี้ของหน่วยงานให้เอง"
                  >
                    💡 ยอดตรงกับ <span className="num">{deposit.suggestion.memberNumber}</span>{" "}
                    {deposit.suggestion.name ?? ""} (ค้างรอบ {deposit.suggestion.roundLabel}{" "}
                    {formatAmount(deposit.suggestion.owed)})
                  </span>
                )}
              </td>
              <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">
                {CHANNEL_LABELS[deposit.channel] ?? deposit.channel}
              </td>
              <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">{deposit.branch}</td>
              <td className="px-2 py-1.5">
                <StatementDetail description={deposit.description} />
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
                        onClick={() =>
                          actions.open({ id: deposit.id, kind: "bind", scope: "deposits" })
                        }
                        className={`hover:underline ${caveat ? "text-amber-700" : "text-slate-900"}`}
                        title={caveat ?? "จำไว้ว่าเลขบัญชีนี้เป็นของสมาชิกคนนี้ ใช้ได้ทุกครั้งต่อไป"}
                      >
                        ระบุเจ้าของ{caveat && " ⚠️"}
                      </button>
                    )}
                    <button
                      onClick={() =>
                        actions.open(
                          { id: deposit.id, kind: "record", scope: "deposits" },
                          deposit.memberNumber ?? deposit.suggestion?.memberNumber ?? null
                        )
                      }
                      className="text-slate-900 hover:underline"
                      title="บันทึกเงินก้อนนี้เป็นรายการของสมาชิก เหมือนที่สลิปทางไลน์ทำ"
                    >
                      บันทึกรายการ
                    </button>
                    {actions.onSplit && (!deposit.memberNumber || (!deposit.senderAccount && deposit.payerName)) && (
                      <button
                        onClick={() => actions.onSplit?.(deposit.id)}
                        className="text-slate-900 hover:underline"
                        title="หน่วยงานโอนมาก้อนเดียวให้สมาชิกหลายคน — แบ่งยอดให้แต่ละคน นับในรอบเทียบ Statement และลงเป็นรายการของแต่ละคน"
                      >
                        แบ่งให้หลายคน
                      </button>
                    )}
                    {/* The way back out of a mark a person made by hand. Not
                        offered on a line the bank's own code classified: that
                        one is not anybody's decision to take back here. */}
                    {deposit.channel === STAFF_CHANNEL && (
                      <button
                        onClick={() => actions.onUnmark(deposit.id)}
                        disabled={actions.saving}
                        className="text-slate-500 hover:underline disabled:opacity-40"
                        title='ระบุผิด — ย้ายกลับไปเป็น "รายการอื่นในบัญชี" ตามรหัสของธนาคาร'
                      >
                        ไม่ใช่เงินสมาชิก
                      </button>
                    )}
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
                  <ActionForm
                    actions={actions}
                    mode={open}
                    targetId={deposit.id}
                    amount={deposit.amount}
                    senderAccount={deposit.senderAccount}
                    picks={deposit.unitPicks}
                  />
                  <p className="text-xs text-slate-500 mt-2">
                    {open === "bind"
                      ? "ผูกเลขบัญชีไว้กับสมาชิก — ไม่ได้บันทึกเงินก้อนนี้เป็นรายการ ถ้าต้องการบันทึกด้วย ให้กด \"บันทึกรายการ\" อีกที"
                      : "ยอดและวันที่ใช้ตามที่ธนาคารบันทึกไว้ ไม่ต้องพิมพ์เอง · ชื่อใส่เฉพาะตอนที่เลขสมาชิกยังไม่มีในทะเบียน (ถ้ามีแล้วระบบใช้ชื่อจากทะเบียน) · ถ้าไม่เข้าหมวดไหนเลย เลือก \"อื่นๆ\" แล้วเขียนว่าเป็นค่าอะไร — ถ้าบันทึกผิด ลบได้ที่แท็บ \"รายการ\""}
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

const OtherTable = ({
  lines,
  showDate = false,
  onMark,
  saving = false,
  unitForm,
  setUnitForm,
  onAddUnit,
}: {
  lines: DailyOtherLineRow[];
  showDate?: boolean;
  onMark: (lineId: string) => void;
  saving?: boolean;
  unitForm?: { lineId: string; name: string } | null;
  setUnitForm?: (form: { lineId: string; name: string } | null) => void;
  onAddUnit?: (line: DailyOtherLineRow, name: string) => void;
}) => (
  /* No scroll wrapper of its own: Section provides one, and nesting two
     makes the horizontal scroll fight itself. */
  <table className="w-full text-sm">
      <thead className="text-slate-500 text-left text-xs uppercase tracking-wide">
        <tr>
          <th className="px-2 py-1.5 font-semibold">{showDate ? "วันที่ / เวลา" : "เวลา"}</th>
          <th className="px-2 py-1.5 font-semibold text-right">ยอด</th>
          <th className="px-2 py-1.5 font-semibold">รหัส</th>
          <th className="px-2 py-1.5 font-semibold">รายละเอียด</th>
          <th className="px-2 py-1.5 font-semibold">บัญชี</th>
          <th className="px-2 py-1.5 font-semibold">ทำอะไรได้</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.id} className="border-t border-slate-100 hover:bg-slate-50">
            <td className="px-2 py-1.5 whitespace-nowrap">
              <Clock iso={line.postedAt} withDate={showDate} />
            </td>
            <td className="px-2 py-1.5 text-right">
              <Money
                value={line.amount}
                className={line.amount < 0 ? "text-slate-500" : "text-slate-900"}
              />
            </td>
            <td className="px-2 py-1.5 font-mono text-xs">{line.txnCode}</td>
            <td className="px-2 py-1.5">
              <StatementDetail description={line.description} />
              {line.payerName && (
                <span className="block text-xs text-slate-600">🏢 {line.payerName}</span>
              )}
              {unitForm?.lineId === line.id && setUnitForm && onAddUnit && (
                <span className="flex flex-wrap items-center gap-2 mt-1">
                  <input
                    value={unitForm.name}
                    onChange={(e) => setUnitForm({ lineId: line.id, name: e.target.value })}
                    placeholder="ชื่อหน่วยงาน"
                    className="border border-slate-300 rounded px-2 py-1 text-xs w-64"
                    autoFocus
                  />
                  <button
                    onClick={() => onAddUnit(line, unitForm.name)}
                    disabled={saving}
                    className="text-xs text-white bg-slate-900 rounded px-2.5 py-1 disabled:opacity-50"
                  >
                    เพิ่มหน่วยงาน
                  </button>
                  <button onClick={() => setUnitForm(null)} className="text-xs text-slate-500">
                    ยกเลิก
                  </button>
                  <span className="w-full text-xs text-slate-400">
                    ยอดของหน่วยงานนี้ทุกรายการจะย้ายไปอยู่ใน "เงินเข้าที่ไม่รู้ว่าใครโอน" ให้บันทึกหรือแบ่งให้สมาชิก
                    · จัดการรายชื่อสมาชิกของหน่วยงานได้ที่กล่อง "หน่วยงานที่โอนแทนสมาชิก" ด้านล่าง
                  </span>
                </span>
              )}
            </td>
            <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">{line.branch}</td>
            <td className="px-2 py-1.5 whitespace-nowrap">
              {line.unitLine && !line.payerName && setUnitForm && (
                <button
                  onClick={() =>
                    setUnitForm(
                      unitForm?.lineId === line.id
                        ? null
                        : { lineId: line.id, name: suggestedPayerName(line.description) }
                    )
                  }
                  disabled={saving}
                  className="text-xs text-slate-900 hover:underline disabled:opacity-40 mr-3"
                  title="หน่วยงานนี้โอนเงินแทนสมาชิก — เพิ่มไว้ในรายชื่อหน่วยงาน ยอดของหน่วยงานนี้จะนับเป็นเงินสมาชิกทุกครั้ง"
                >
                  🏢 เพิ่มเป็นหน่วยงาน
                </button>
              )}
              {/* Only on money coming in. Nothing a person knows makes an
                  outward transfer or a fee into a member's payment, so the
                  button is not offered rather than offered and refused. */}
              {line.amount > 0 ? (
                <button
                  onClick={() => onMark(line.id)}
                  disabled={saving}
                  className="text-xs text-slate-900 hover:underline disabled:opacity-40"
                  title={
                    "ระบุว่าเงินก้อนนี้เป็นสมาชิกโอนเข้ามา ทั้งที่รหัสธนาคารยังไม่รู้จัก — " +
                    'ย้ายไปอยู่ใน "เงินเข้าที่ไม่รู้ว่าใครโอน" เพื่อบันทึกต่อ ยังไม่ได้บันทึกอะไรตอนนี้ และย้อนกลับได้'
                  }
                >
                  เป็นเงินสมาชิก
                </button>
              ) : (
                <span className="text-xs text-slate-300">—</span>
              )}
            </td>
          </tr>
        ))}
    </tbody>
  </table>
);
