"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  formatAmount,
  formatStatementDate,
  formatStatementDateTime,
  formatStatementTime,
} from "@/lib/format";
import {
  CarriedDebtRow,
  StatementFileSummary,
  StatementMemberRow,
  StatementRoundSummary,
  StatementTransferRow,
  RecordedOutsideRow,
  StatementOutsideRoundRow,
  StatementUnmatchedRow,
} from "@/lib/types";

import ConfirmDialog from "@/components/ConfirmDialog";
import CarryToDebtForm from "@/components/CarryToDebtForm";
import { memberNumberKey } from "@/lib/memberNumber";
import { outstandingAtClose } from "@/lib/carriedDebt";
import SheetMappingDialog, { type SheetPreview } from "@/components/SheetMappingDialog";
import type { SheetMapping } from "@/lib/sheetColumns";
import MultiSelect from "@/components/MultiSelect";
import PanelHelp from "@/components/PanelHelp";
import { controlUnitLabel } from "@/lib/controlUnits";
import { describeDeductionPeriod } from "@/lib/deductionPeriod";
import { downloadStatementMembersCsv } from "@/lib/csv";
import { EXCLUDE_REASONS } from "@/lib/statementSlipHints";
import { SET_ASIDE_CATEGORIES } from "@/lib/transferSetAside";
import { describeDoubleCount } from "@/lib/roundDoubleCount";
import { cooperativeToday } from "@/lib/cooperativeClock";
import { sectionOpen } from "@/lib/sections";
import { memberDifference } from "@/lib/statementReconcile";
import {
  UNMATCHED_SORT_OPTIONS,
  sortUnmatched,
  type UnmatchedSort,
} from "@/lib/unmatchedSort";
import {
  STATEMENT_SECTION_OPEN_BY_DEFAULT,
  STATEMENT_SECTION_SEARCHABLE,
  allStatementSections,
  type StatementSectionKey,
} from "@/lib/statementSections";
import {
  StatementSort,
  filterStatementMembers,
  hCodesOf,
  matchesStatus,
  parseSubUnit,
  sortStatementMembers,
  subUnitsOf,
  summarizeStatementMembers,
} from "@/lib/statementFilters";

const SEARCH_DEBOUNCE_MS = 300;

// Orderings that can be stacked, applied in the order they were chosen:
// หน่วยคุม then ยอดค้าง is "work through the units, biggest debt first in
// each", which no single ordering can ask for.
const SORT_OPTIONS: { value: StatementSort; label: string }[] = [
  { value: "hCode", label: "หน่วยคุม" },
  { value: "unitName", label: "หน่วยคุมย่อย" },
  { value: "outstanding", label: "ยอดค้างมาก → น้อย" },
  { value: "paidAt", label: "วันที่โอน (ล่าสุดก่อน)" },
  { value: "name", label: "ชื่อ ก-ฮ" },
  { value: "memberNumber", label: "เลขสมาชิก" },
];

// หน่วยคุม, because that is how the work is divided: whoever is chasing a
// unit wants that unit's people together before anything else.
const DEFAULT_SORT: StatementSort[] = ["hCode"];

const STATUS_LABEL: Record<string, string> = {
  paid: "✅ ชำระครบ",
  overpaid: "⚠️ ชำระเกิน",
  unpaid: "❌ ยังค้าง",
  // Not payment statuses: what the member's unit has said about the deduction
  // itself. A round that starts from the รายการหัก holds these two long
  // before anybody is short of anything.
  awaiting: "⏳ รอผลการหัก",
  collected: "✅ หักได้ครบ",
};

const STATUS_CLASS: Record<string, string> = {
  paid: "bg-green-50 text-green-700 border-green-200",
  overpaid: "bg-amber-50 text-amber-700 border-amber-200",
  unpaid: "bg-red-50 text-red-700 border-red-200",
  awaiting: "bg-slate-50 text-slate-600 border-slate-200",
  collected: "bg-slate-50 text-slate-500 border-slate-200",
};

const ACCOUNTS = [
  { value: "413", label: "413 หนองคาย" },
  { value: "447", label: "447 บึงกาฬ" },
];

const STATEMENT_BRANCH: Record<string, string> = { "413": "หนองคาย", "447": "บึงกาฬ" };

const FilterChip = ({
  active,
  onClick,
  label,
  count,
  countClass,
  suffix,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  countClass?: string;
  suffix?: string;
  title?: string;
}) => (
  <button
    onClick={onClick}
    title={title}
    className={`px-3 py-1.5 rounded-full border transition-colors ${
      active
        ? "border-slate-900 bg-slate-900 text-white"
        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
    }`}
  >
    {label}{" "}
    <strong className={`num font-semibold ${active ? "" : (countClass ?? "text-slate-900")}`}>
      {count}
    </strong>
    {suffix && ` ${suffix}`}
  </button>
);

// The date on its own line with the clock reading under it, so the column
// stays narrow and the dates still line up to be compared down the page.
// Rounds loaded from an export that carried no time simply have no second
// line — see formatStatementTime.
const DateTimeCell = ({ iso, suffix }: { iso: string | null; suffix?: string | null }) => {
  const time = formatStatementTime(iso);
  return (
    <span className="inline-block leading-tight">
      <span className="num">{formatStatementDate(iso)}</span>
      {suffix && <span className="text-xs text-slate-400"> · {suffix}</span>}
      {time && <span className="block num text-xs text-slate-400">{time}</span>}
    </span>
  );
};

export default function StatementReconcilePanel() {
  const [rounds, setRounds] = useState<StatementRoundSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<StatementMemberRow[]>([]);
  const [unmatched, setUnmatched] = useState<StatementUnmatchedRow[]>([]);
  // Bound to a member who is not on this round's list. Kept apart from the
  // list above so that pressing บันทึก visibly finishes a row — see
  // lib/boundTransfers.ts.
  const [outsideRound, setOutsideRound] = useState<StatementOutsideRoundRow[]>([]);
  const [outsideRoundTotal, setOutsideRoundTotal] = useState(0);
  // Whether the "take every answer the daily page already has" list is up for
  // approval. A flag rather than a copy of the list, so the dialog reads the
  // rows on screen and cannot show one thing while sending another.
  const [confirmRecorded, setConfirmRecorded] = useState(false);
  // How the unclaimed list is ordered. Its own control rather than the member
  // table's: the questions asked of this list are different — see
  // lib/unmatchedSort.ts.
  const [unmatchedSort, setUnmatchedSort] = useState<UnmatchedSort>("newest");
  // An uploaded sheet waiting to be confirmed: the file, what it is for, and
  // how its columns were read. Nothing is written until somebody agrees with
  // the reading — see components/SheetMappingDialog.tsx.
  const [pendingSheet, setPendingSheet] = useState<{
    file: File;
    kind: "list" | "results";
    preview: SheetPreview;
    mapping: SheetMapping;
    sheet: number;
  } | null>(null);
  const [statements, setStatements] = useState<StatementFileSummary[]>([]);
  const [transfers, setTransfers] = useState<StatementTransferRow[]>([]);
  const [recordedOutside, setRecordedOutside] = useState<RecordedOutsideRow[]>([]);
  const [excludedTotal, setExcludedTotal] = useState(0);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  // The one transfer row currently offering its "แบ่งให้สมาชิกอื่น" form, and
  // what is typed into it — one at a time, the same as opening a บันทึก form
  // elsewhere in the dashboard closes whichever was open before it.
  const [splittingTransfer, setSplittingTransfer] = useState<string | null>(null);
  // The transfer whose "ชำระข้ามเดือน" form is open, if any.
  const [carryingTransfer, setCarryingTransfer] = useState<string | null>(null);
  // Every carried debt still owing, across all closed rounds — read once and
  // indexed by member, to warn on a member who owes an earlier month too.
  const [openDebts, setOpenDebts] = useState<CarriedDebtRow[]>([]);
  const [pendingClose, setPendingClose] = useState(false);
  const [splitMemberNumber, setSplitMemberNumber] = useState("");
  const [splitAmountInput, setSplitAmountInput] = useState("");
  // "✂️ ตัดยอดออก": the transfer whose form is open, and what it asks — how
  // much of it, and what that part was for. See lib/transferSetAside.ts.
  const [asideTransfer, setAsideTransfer] = useState<string | null>(null);
  const [asideAmount, setAsideAmount] = useState("");
  const [asideCategory, setAsideCategory] = useState<string>(SET_ASIDE_CATEGORIES[0]);
  const [asideError, setAsideError] = useState<string | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);
  // The one member currently offering the "บันทึกเงินสด" form — a payment
  // that never touches a bank account at all, so no Statement upload could
  // ever bring it in on its own. See app/api/statement-rounds/[id]/cash.
  const [cashMember, setCashMember] = useState<string | null>(null);
  const [cashAmount, setCashAmount] = useState("");
  const [cashDate, setCashDate] = useState(cooperativeToday());
  const [cashError, setCashError] = useState<string | null>(null);
  // Without "file", the whole account.
  const [pendingClear, setPendingClear] = useState<{
    account: string;
    branch: string;
    file?: { name: string | null; transfers: number };
  } | null>(null);
  const [showStatementFiles, setShowStatementFiles] = useState(false);
  const [totals, setTotals] = useState({ due: 0, paid: 0, outstanding: 0 });
  const [loadingRounds, setLoadingRounds] = useState(true);
  const [loadingRound, setLoadingRound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<StatementRoundSummary | null>(null);
  // A member-list upload the server refused to do quietly because it would
  // take most of the round away. The file is held so confirming does not make
  // staff pick it again.
  const [pendingShrink, setPendingShrink] = useState<{
    file: File;
    roundId: string;
    description: string;
    // Held with the file so confirming re-sends the same reading, not a
    // fresh guess at a sheet somebody already corrected.
    mapping?: SheetMapping;
    firstDataRow?: number;
    sheet?: number;
  } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  // Which account's own CSV to export — "" is everyone, exactly what the
  // export did before this existed. Narrows by paidBranch (see
  // recomputeRoundPayments), which is null for anyone who has not paid at
  // all: unpaid members belong to no account's statement yet, so they drop
  // out of a หนองคาย-only or บึงกาฬ-only export and appear only in รวม.
  const [csvBranch, setCsvBranch] = useState<"" | "หนองคาย" | "บึงกาฬ">("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // The หน่วยคุม, and the หน่วยคุมย่อย inside it as one encoded value —
  // see encodeSubUnit, which keys on the รหัสสังกัด where the round has one.
  const [unitNames, setUnitNames] = useState<Record<string, string>>({});
  const [hCodeFilter, setHCodeFilter] = useState<string[]>([]);
  const [subUnitFilter, setSubUnitFilter] = useState<string[]>([]);
  const [assigningAccount, setAssigningAccount] = useState<string | null>(null);
  const [assignMemberNumber, setAssignMemberNumber] = useState("");
  // What happened to the last attempt on this account, shown at its own row.
  // Both the panel's error and its notice are painted at the top, thousands of
  // pixels above a table that runs to hundreds of rows — from down here,
  // failure and a success with a caveat both look like nothing happening.
  const [assignNote, setAssignNote] = useState<
    { account: string; text: string; bad: boolean } | null
  >(null);
  const [sort, setSort] = useState<StatementSort[]>(DEFAULT_SORT);
  // What this person has clicked open or shut. Empty until they touch a
  // heading, which is what leaves the defaults and the search free to decide
  // — see lib/statementSections.ts.
  const [clicked, setClicked] = useState<Partial<Record<StatementSectionKey, boolean>>>({});

  const [showNew, setShowNew] = useState(false);
  const [newPeriod, setNewPeriod] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [labelTouched, setLabelTouched] = useState(false);

  const [account, setAccount] = useState("413");
  const membersInputRef = useRef<HTMLInputElement | null>(null);
  const deductionListInputRef = useRef<HTMLInputElement | null>(null);
  const statementInputRef = useRef<HTMLInputElement | null>(null);

  const fetchRounds = useCallback(async () => {
    setLoadingRounds(true);
    const res = await fetch("/api/statement-rounds");
    const body = await res.json();
    setLoadingRounds(false);
    setRounds(body.data ?? []);
    return body.data as StatementRoundSummary[] | undefined;
  }, []);

  const fetchRound = useCallback(async (roundId: string) => {
    setLoadingRound(true);
    const res = await fetch(`/api/statement-rounds/${roundId}`);
    const body = await res.json();
    setMembers(body.data ?? []);
    setUnmatched(body.unmatched ?? []);
    setOutsideRound(body.outsideRound ?? []);
    setOutsideRoundTotal(body.outsideRoundTotal ?? 0);
    setStatements(body.statements ?? []);
    setTransfers(body.transfers ?? []);
    setRecordedOutside(body.recordedOutside ?? []);
    setExcludedTotal(body.excludedTotal ?? 0);
    setTotals(body.totals ?? { due: 0, paid: 0, outstanding: 0 });
    setLoadingRound(false);
  }, []);

  const setTransferReason = async (transferId: string, excludedReason: string | null) => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/statement-rounds/${selectedId}/transfers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transferId, excludedReason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "บันทึกไม่สำเร็จ");
        return;
      }
      await Promise.all([fetchRound(selectedId), fetchRounds()]);
    } finally {
      setBusy(false);
    }
  };

  const openSplit = (transfer: StatementTransferRow) => {
    setSplittingTransfer(transfer.id);
    setSplitMemberNumber("");
    // Defaults to the whole amount — most of the time a combined transfer is
    // "this whole line was never mine", not a partial share, and retyping
    // the figure already on screen would be asking for a slip.
    setSplitAmountInput(String(transfer.amount));
    setSplitError(null);
  };

  const closeSplit = () => {
    setSplittingTransfer(null);
    setSplitError(null);
  };

  const submitSplit = async (transferId: string) => {
    if (!selectedId) return;
    setSplitError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/statement-rounds/${selectedId}/transfers/${transferId}/split`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            memberNumber: splitMemberNumber.trim(),
            amount: Number(splitAmountInput),
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSplitError(body.error || "แบ่งยอดไม่สำเร็จ");
        return;
      }
      closeSplit();
      await Promise.all([fetchRound(selectedId), fetchRounds()]);
    } finally {
      setBusy(false);
    }
  };

  const openAside = (transfer: StatementTransferRow) => {
    setAsideTransfer(transfer.id);
    setAsideAmount("");
    setAsideCategory(SET_ASIDE_CATEGORIES[0]);
    setAsideError(null);
  };

  const submitAside = async (transferId: string) => {
    if (!selectedId) return;
    setAsideError(null);
    setBusy(true);
    try {
      const res = await fetch(
        `/api/statement-rounds/${selectedId}/transfers/${transferId}/set-aside`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: Number(asideAmount), category: asideCategory }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setAsideError(body.error || "ตัดยอดไม่สำเร็จ");
        return;
      }
      setAsideTransfer(null);
      await Promise.all([fetchRound(selectedId), fetchRounds()]);
    } finally {
      setBusy(false);
    }
  };

  // Puts a cut-out part back into the row it came from.
  const restoreAside = async (pieceId: string) => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/statement-rounds/${selectedId}/transfers/${pieceId}/set-aside`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "รวมยอดกลับไม่สำเร็จ");
        return;
      }
      await Promise.all([fetchRound(selectedId), fetchRounds()]);
    } finally {
      setBusy(false);
    }
  };

  const openCash = (memberNumber: string) => {
    setCashMember(memberNumber);
    setCashAmount("");
    setCashDate(cooperativeToday());
    setCashError(null);
  };

  const closeCash = () => {
    setCashMember(null);
    setCashError(null);
  };

  const submitCash = async (memberNumber: string) => {
    if (!selectedId) return;
    setCashError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/statement-rounds/${selectedId}/cash`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberNumber,
          amount: Number(cashAmount),
          transferredAt: cashDate,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setCashError(body.error || "บันทึกเงินสดไม่สำเร็จ");
        return;
      }
      closeCash();
      await Promise.all([fetchRound(selectedId), fetchRounds()]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    fetchRounds().then((data) => {
      if (data && data.length > 0) setSelectedId((prev) => prev ?? data[0].id);
    });
  }, [fetchRounds]);

  const fetchOpenDebts = useCallback(async () => {
    const res = await fetch("/api/carried-debts?open=1");
    if (!res.ok) return;
    const body = await res.json();
    setOpenDebts(body.data ?? []);
  }, []);

  useEffect(() => {
    fetchOpenDebts();
  }, [fetchOpenDebts]);

  // The หน่วยคุม names staff maintain in ตั้งค่าระบบ. Fetched rather than
  // compiled in, so a unit renamed there shows its new name here without a
  // deploy; controlUnitLabel still answers for anything this has not got.
  useEffect(() => {
    fetch("/api/control-units")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!body?.data) return;
        setUnitNames(
          Object.fromEntries(
            (body.data as { code: string; name: string }[]).map((u) => [u.code, u.name])
          )
        );
      })
      .catch(() => {});
  }, []);

  // Debounced so typing in the search box doesn't re-filter on every keystroke
  // — same 300ms the other panels' search boxes use.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // A new search makes every section a different list, so what was clicked
  // about the old one stops meaning anything. Without this, ย่อทั้งหมด
  // followed by a search hides the rows it just found — the headings count
  // the hits and nothing appears under them.
  useEffect(() => {
    setClicked({});
  }, [search]);

  useEffect(() => {
    if (selectedId) fetchRound(selectedId);
    else {
      setMembers([]);
      setUnmatched([]);
      setOutsideRound([]);
      setStatements([]);
    }
    setNotice(null);
    setError(null);
    // A different round has different units and different people in it, so
    // carrying the previous round's filters over would show an empty table
    // for no visible reason.
    setStatusFilter("all");
    setSearchInput("");
    setSearch("");
    setSubUnitFilter([]);
    setHCodeFilter([]);
    setClicked({});
  }, [selectedId, fetchRound]);

  const createRound = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/statement-rounds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: newPeriod.trim(), label: newLabel.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "สร้างรอบไม่สำเร็จ");
        return;
      }
      setShowNew(false);
      setNewPeriod("");
      setNewLabel("");
      setLabelTouched(false);
      await fetchRounds();
      setSelectedId(body.id);
    } finally {
      setBusy(false);
    }
  };

  // Split from the change handler so the same file can be sent again with
  // confirm=yes after the shrink question, without asking staff to pick it a
  // second time — re-picking is where the wrong file gets chosen twice.
  // Where a filled-in account number came from, said out loud: the directory
  // is a binding somebody made, an earlier round is the cooperative's own
  // sheet from a previous month — which used to be invisible here, and is the
  // reason a member whose account was in August's file read as
  // "ไม่มีเลขบัญชี" in September. See lib/accountHistory.ts.
  const describeFills = (body: {
    filledFromDirectory?: number;
    filledFromPrevious?: number;
    ambiguousAccounts?: number;
  }) =>
    ((body.filledFromDirectory ?? 0) > 0
      ? ` — เติมเลขบัญชีจากทะเบียนให้ ${body.filledFromDirectory} คน`
      : "") +
    ((body.filledFromPrevious ?? 0) > 0
      ? ` · เติมจากรอบก่อนหน้าให้อีก ${body.filledFromPrevious} คน`
      : "") +
    ((body.ambiguousAccounts ?? 0) > 0
      ? ` · อีก ${body.ambiguousAccounts} คนรู้จักหลายเลขบัญชี จึงไม่เติมให้ ต้องเลือกเอง`
      : "");

  const sendMembers = async (
    file: File,
    roundId: string,
    confirm: boolean,
    mapping?: SheetMapping,
    firstDataRow?: number,
    sheet?: number,
    // Add this unit's people to the round instead of making the file the
    // whole round — see the "mode=append" branch in the members route.
    append?: boolean
  ) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (confirm) form.append("confirm", "yes");
      if (append) form.append("mode", "append");
      if (mapping) {
        form.append("mapping", JSON.stringify(mapping));
        form.append("firstDataRow", String(firstDataRow ?? 0));
      }
      form.append("sheet", String(sheet ?? 0));
      const res = await fetch(`/api/statement-rounds/${roundId}/members`, {
        method: "POST",
        body: form,
      });
      const body = await res.json();
      if (res.status === 409 && body.needsConfirm) {
        // Not an error — the upload is legitimate but destructive, so it
        // waits for a person to look at the numbers.
        setPendingShrink({ file, roundId, description: body.error, mapping, firstDataRow, sheet });
        return;
      }
      if (!res.ok) {
        setError(body.error || "อัปโหลดรายชื่อไม่สำเร็จ");
        return;
      }
      // A seeded round is updated, not replaced, so the answer is about what
      // this file changed rather than about the round's new size — and it
      // says how much of the round the file did not mention, which is the
      // only way to tell one unit's file from the whole cooperative's.
      if (body.applied) {
        setNotice(
          (body.appended ? "เพิ่มเข้ารอบแล้ว: " : "บันทึกผลการหักแล้ว: ") +
            `อัปเดต ${body.updated} คน` +
            (body.added > 0 ? `, เพิ่มใหม่ ${body.added} คน` : "") +
            ` — ตอนนี้หักไม่ได้ ${body.uncollected} คน, หักได้ครบ ${body.collected} คน` +
            (body.awaiting > 0
              ? `, ยังรอผลอีก ${body.awaiting} คน (${body.unitsAwaiting?.length ?? 0} หน่วยคุม)`
              : " — ครบทุกหน่วยแล้ว") +
            (body.untouched > 0
              ? ` · ไฟล์นี้ไม่ได้พูดถึงอีก ${body.untouched} คนในรอบ จึงคงไว้ตามเดิม`
              : "") +
            (body.keptResult > 0
              ? ` · ${body.keptResult} คนในไฟล์ยังไม่มีผล แต่รอบมีผลอยู่แล้ว จึงไม่ทับ`
              : "") +
            // The unit's own "รหัสหน่วย" is its internal สังกัด code, not one
            // of the cooperative's 64 หน่วยคุม — said out loud so nobody
            // wonders why the column did not change.
            (body.keptUnit > 0
              ? ` · คงหน่วยคุมเดิมของรอบไว้ ${body.keptUnit} คน (ไฟล์หน่วยใช้รหัสของตัวเอง)`
              : "") +
            describeFills(body) +
            (body.missingAccount > 0
              ? ` — ⚠️ มี ${body.missingAccount} คนที่หักไม่ได้แต่ไม่มีเลขบัญชี จับคู่กับ Statement ไม่ได้`
              : "")
        );
        await Promise.all([fetchRound(roundId), fetchRounds()]);
        return;
      }
      setNotice(
        `นำเข้ารายชื่อหักไม่ได้ ${body.imported} คน` +
          (body.removed > 0
            ? ` (เอาออก ${body.removed} คน${
                body.removedUnits > 0 ? ` รวม ${body.removedUnits} หน่วยงานที่หายไปทั้งหน่วย` : ""
              })`
            : "") +
          (body.awaitingMembers > 0
            ? ` (อีก ${body.awaitingMembers} คนใน ${body.awaitingUnits} หน่วยงานยังไม่ส่งผลการหักมา จึงยังไม่นับ)`
            : "") +
          describeFills(body) +
          (body.missingAccount > 0
            ? ` — มี ${body.missingAccount} คนไม่มีเลขบัญชีในไฟล์ จับคู่กับ Statement ไม่ได้`
            : "")
      );
      await Promise.all([fetchRound(roundId), fetchRounds()]);
    } finally {
      setBusy(false);
    }
  };

  // Both uploads go through the same door: read the file, show what the
  // system made of its columns, and save only what a person confirmed. Every
  // เขต builds its own file — see lib/sheetColumns.ts for the two real shapes
  // that made this necessary.
  const openSheet = async (file: File, kind: "list" | "results") => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/statement-rounds/${selectedId}/sheet-preview`, {
        method: "POST",
        body: form,
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "อ่านไฟล์ไม่สำเร็จ");
        return;
      }
      setPendingSheet({
        file,
        kind,
        preview: body,
        mapping: body.mapping,
        sheet: body.sheetIndex ?? 0,
      });
    } finally {
      setBusy(false);
    }
  };

  const changeMapping = async (mapping: SheetMapping) => {
    if (!pendingSheet || !selectedId) return;
    setPendingSheet({ ...pendingSheet, mapping });
    const form = new FormData();
    form.append("file", pendingSheet.file);
    form.append("sheet", String(pendingSheet.sheet));
    form.append("mapping", JSON.stringify(mapping));
    form.append("firstDataRow", String(pendingSheet.preview.firstDataRow));
    const res = await fetch(`/api/statement-rounds/${selectedId}/sheet-preview`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) return;
    const body = await res.json();
    // Only the reading changes; the columns and the file stay as they were.
    setPendingSheet((prev) =>
      prev && prev.file === pendingSheet.file
        ? { ...prev, preview: { ...body, mapping }, mapping }
        : prev
    );
  };

  // Another page of the same workbook. No mapping is sent with it: the
  // columns of "สรุป" are not the columns of "หน่วย", and carrying the last
  // sheet's choices across would map the new sheet to the old one's shape.
  const pickSheet = async (sheetIndex: number) => {
    if (!pendingSheet || !selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", pendingSheet.file);
      form.append("sheet", String(sheetIndex));
      const res = await fetch(`/api/statement-rounds/${selectedId}/sheet-preview`, {
        method: "POST",
        body: form,
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "อ่านชีตนี้ไม่ได้");
        return;
      }
      setPendingSheet((prev) =>
        prev
          ? { ...prev, preview: body, mapping: body.mapping, sheet: body.sheetIndex ?? sheetIndex }
          : prev
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmSheet = async () => {
    if (!pendingSheet || !selectedId) return;
    const { file, kind, mapping, preview, sheet } = pendingSheet;
    setPendingSheet(null);
    if (kind === "list") {
      await sendDeductionList(file, selectedId, mapping, preview.firstDataRow, sheet);
    } else {
      await sendMembers(file, selectedId, false, mapping, preview.firstDataRow, sheet);
    }
  };

  const uploadMembers = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await openSheet(file, "results");
  };

  // The รายการหัก that starts the round. Merges, so the whole cooperative can
  // go in at once or one เขต at a time, and re-uploading a corrected file
  // never takes the rest of the round away.
  const uploadDeductionList = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await openSheet(file, "list");
  };

  const sendDeductionList = async (
    file: File,
    roundId: string,
    mapping: SheetMapping,
    firstDataRow: number,
    sheet: number
  ) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("sheet", String(sheet));
      form.append("mapping", JSON.stringify(mapping));
      form.append("firstDataRow", String(firstDataRow));
      const res = await fetch(`/api/statement-rounds/${roundId}/deduction-list`, {
        method: "POST",
        body: form,
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "อัปโหลดรายการหักไม่สำเร็จ");
        return;
      }
      setNotice(
        `นำเข้ารายการหัก: เพิ่มใหม่ ${body.added} คน` +
          (body.updated > 0 ? `, อัปเดต ${body.updated} คน` : "") +
          ` — รอบนี้มีทั้งหมด ${body.members} คน` +
          (body.awaiting > 0
            ? `, รอผลการหัก ${body.awaiting} คน (ส่งผลแล้ว ${body.unitsReported}/${body.units} หน่วยคุม)`
            : "") +
          (body.keptResult > 0
            ? ` · ${body.keptResult} คนมีผลการหักอยู่แล้ว จึงไม่ทับด้วย "รอผล"`
            : "") +
          (body.keptUnit > 0
            ? ` · คงหน่วยคุมเดิมของรอบไว้ ${body.keptUnit} คน (ไฟล์นี้ใช้รหัสของหน่วยเอง)`
            : "") +
          (body.skippedRows > 0
            ? ` · ข้าม ${body.skippedRows} แถวที่ไม่มีเลขสมาชิก`
            : "") +
          describeFills(body)
      );
      await Promise.all([fetchRound(roundId), fetchRounds()]);
    } finally {
      setBusy(false);
    }
  };

  const uploadStatement = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selectedId) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("account", account);
      const res = await fetch(`/api/statement-rounds/${selectedId}/statement`, {
        method: "POST",
        body: form,
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "อ่าน Statement ไม่สำเร็จ");
        return;
      }
      setNotice(
        `บัญชี ${body.account} ${body.branch}: อ่านได้ ${body.transfers} รายการ ` +
          `เพิ่มใหม่ ${body.added} รายการ` +
          (body.refreshed > 0
            ? ` (มีอยู่แล้ว ${body.refreshed} รายการ — อ่านทับให้ใหม่ ไม่นับซ้ำ)`
            : "") +
          `, จับคู่สมาชิกได้ ${body.matched} คน` +
          (body.unmatched > 0 ? `, ไม่พบเจ้าของ ${body.unmatched} รายการ` : "")
      );
      await Promise.all([fetchRound(selectedId), fetchRounds()]);
    } finally {
      setBusy(false);
    }
  };

  const assignAccount = async (accountNumber: string) => {
    if (!selectedId || !assignMemberNumber.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/statement-rounds/${selectedId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountNumber, memberNumber: assignMemberNumber.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        const message = body.error || "ระบุเจ้าของไม่สำเร็จ";
        setAssignNote({ account: accountNumber, text: message, bad: true });
        setError(message);
        return;
      }

      const notCounted =
        "— จำไว้ใช้รอบต่อไปและหน้าเงินเข้าประจำวันให้แล้ว · " +
        `แต่รอบนี้ยังไม่นับเป็นการชำระ เพราะ ${body.memberNumber} ไม่ได้อยู่ในรายชื่อหักไม่ได้รอบนี้ ` +
        "(ไม่ได้ค้างอะไรในรอบนี้ จึงไม่มีอะไรให้ตัด)";
      const saved =
        `ผูกบัญชี ${body.accountNumber} เข้ากับ ${body.memberNumber} ${body.memberName ?? ""} แล้ว ` +
        (body.onRound
          ? `(${body.transfers} รายการ ${formatAmount(body.amount)}) — จำไว้ใช้รอบต่อไปให้แล้ว`
          : body.inRoster
            ? `${notCounted} · ย้ายไปอยู่ในหัวข้อ "รู้เจ้าของแล้ว แต่ไม่ได้อยู่ในรอบนี้" ข้างล่างแล้ว`
            : // In no list at all: the row stays where it is on purpose, so
              // the message must not claim it moved.
              `${notCounted} — ⚠️ ไม่พบเลขสมาชิกนี้ในทะเบียนสมาชิกด้วย ` +
              "ตรวจสอบว่าพิมพ์ถูกไหม · รายการยังอยู่ในรายการเดิม พร้อมคำเตือนที่แถวนั้น");
      setNotice(saved);
      // A row bound to somebody real leaves this list — matched into the
      // round, or down into "รู้เจ้าของแล้ว แต่ไม่ได้อยู่ในรอบนี้" — and the
      // list shrinking is the answer. A number in no list keeps its row, and
      // the row carries its own warning, so neither case needs a note here.
      setAssignNote(null);
      setAssigningAccount(null);
      setAssignMemberNumber("");
      await Promise.all([fetchRound(selectedId), fetchRounds()]);
    } finally {
      setBusy(false);
    }
  };

  // Takes every answer the daily page already has, in one save. Each of these
  // can be made by hand on its own row; this is the same thing for somebody
  // who has just read the list and agreed with all of it, which is why the
  // list is shown first and the rows are sent back as they were displayed.
  const applyRecordedOwners = async () => {
    if (!selectedId) return;
    setConfirmRecorded(false);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/statement-rounds/${selectedId}/assign-recorded`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bindings: recordedBindings.map((b) => ({
            accountNumber: b.accountNumber,
            memberNumber: b.memberNumber,
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "ผูกเจ้าของไม่สำเร็จ");
        return;
      }
      setNotice(
        `ผูกเลขบัญชีตามที่เงินเข้าประจำวันบันทึกไว้ ${body.applied} บัญชี — ` +
          `รอบนี้จับคู่ได้ ${body.matched} บัญชี` +
          (body.outsideRound > 0
            ? `, อีก ${body.outsideRound} บัญชีเป็นสมาชิกที่ไม่ได้อยู่ในรอบนี้ ` +
              '(ไปอยู่หัวข้อ "รู้เจ้าของแล้ว แต่ไม่ได้อยู่ในรอบนี้")'
            : "") +
          (body.stale > 0
            ? ` — ⚠️ ข้าม ${body.stale} บัญชีที่ข้อมูลเปลี่ยนไประหว่างนี้ ให้ดูทีละแถวเอง`
            : "")
      );
      await Promise.all([fetchRound(selectedId), fetchRounds()]);
    } finally {
      setBusy(false);
    }
  };

  const confirmClearAccount = async () => {
    if (!pendingClear || !selectedId) return;
    const { account: acct, branch, file } = pendingClear;
    setPendingClear(null);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const query = new URLSearchParams({ account: acct });
      if (file) query.set("file", file.name ?? "");
      const res = await fetch(`/api/statement-rounds/${selectedId}/statement?${query}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || (file ? "ลบไฟล์ไม่สำเร็จ" : "ล้างรายการไม่สำเร็จ"));
        return;
      }
      setNotice(
        file
          ? `ลบ ${body.lines} รายการของไฟล์ ${file.name ?? "(ไม่ทราบชื่อไฟล์)"} ` +
              `ออกจากบัญชี ${acct} ${branch} ในรอบนี้แล้ว`
          : `ล้างรายการโอนของบัญชี ${acct} ${branch} แล้ว ${body.removed} รายการ`
      );
      await Promise.all([fetchRound(selectedId), fetchRounds()]);
    } finally {
      setBusy(false);
    }
  };

  // One-time cleanup for a summary row ("รวม", "รวมทั้งสิ้น") imported as if
  // it were a member — a sheet-reading gap closed for new uploads, but not
  // for a round built before that fix. Global rather than scoped to the
  // round on screen: the same leftover row can sit in any round created
  // before the guard existed. See app/api/statement-rounds/fix-implausible-members.
  const fixImplausibleMembers = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/statement-rounds/fix-implausible-members", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "ลบไม่สำเร็จ");
        return;
      }
      setNotice(
        body.removed > 0
          ? `ลบแถวสรุปที่ติดมาเป็นสมาชิกแล้ว ${body.removed} รายการ (${(body.removedNumbers ?? []).join(", ")})`
          : "ไม่พบแถวสรุปที่ติดมาเป็นสมาชิก"
      );
      await Promise.all(selectedId ? [fetchRound(selectedId), fetchRounds()] : [fetchRounds()]);
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteRound = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    setError(null);
    const res = await fetch(`/api/statement-rounds/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "ลบรอบไม่สำเร็จ");
      return;
    }
    const data = await fetchRounds();
    setSelectedId(data && data.length > 0 ? data[0].id : null);
  };

  // Month end: freeze the round and carry what members still owe on it to
  // the ชำระข้ามเดือน tab. See app/api/statement-rounds/[id]/close.
  const closeRound = async () => {
    setPendingClose(false);
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/statement-rounds/${selectedId}/close`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "ปิดรอบไม่สำเร็จ");
        return;
      }
      setNotice(
        `ปิดรอบแล้ว — ยกยอดค้าง ${body.carried} คน รวม ${formatAmount(body.carriedAmount)} ` +
          `ไปที่แถบ "ชำระข้ามเดือน"` +
          (body.awaiting > 0 ? ` · ${body.awaiting} คนยังรอผลการหัก ไม่ได้ถูกยกยอดไป` : "")
      );
      await Promise.all([fetchRound(selectedId), fetchRounds(), fetchOpenDebts()]);
    } finally {
      setBusy(false);
    }
  };

  const reopenRound = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/statement-rounds/${selectedId}/close`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "เปิดรอบไม่สำเร็จ");
        return;
      }
      setNotice(`เปิดรอบอีกครั้งแล้ว — ยกเลิกยอดยกไปชำระข้ามเดือน ${body.removedDebts} รายการ`);
      await Promise.all([fetchRound(selectedId), fetchRounds(), fetchOpenDebts()]);
    } finally {
      setBusy(false);
    }
  };

  // Rebuilds members' figures from the transfers the round already holds —
  // see app/api/statement-rounds/[id]/recompute.
  const recomputeRound = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/statement-rounds/${selectedId}/recompute`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "คำนวณยอดใหม่ไม่สำเร็จ");
        return;
      }
      setNotice("คำนวณยอดของรอบนี้ใหม่จากรายการโอนแล้ว");
      await Promise.all([fetchRound(selectedId), fetchRounds()]);
    } finally {
      setBusy(false);
    }
  };

  const afterCarry = async () => {
    setCarryingTransfer(null);
    if (selectedId) await Promise.all([fetchRound(selectedId), fetchRounds()]);
    await fetchOpenDebts();
  };

  const selected = rounds.find((r) => r.id === selectedId) ?? null;
  // A closed round is read-only — every write route refuses it anyway (see
  // ROUND_CLOSED_ERROR); greying the controls saves staff the round trip.
  const frozen = !!selected?.closedAt;
  const hCodes = hCodesOf(members);
  const unitLabel = (code: string) =>
    unitNames[code] ? `${code} ${unitNames[code]}` : controlUnitLabel(code);
  // The หน่วยคุมย่อย on offer narrow to whatever หน่วยคุม is chosen.
  const subUnits = subUnitsOf(members, hCodeFilter);
  const shown = sortStatementMembers(
    filterStatementMembers(members, {
      search,
      hCodes: hCodeFilter,
      subUnits: subUnitFilter,
      status: statusFilter,
    }),
    sort
  );
  const shownTotals = summarizeStatementMembers(shown);
  // Narrows what the export button sends to downloadStatementMembersCsv,
  // on top of every other filter already on screen — includes() rather than
  // === because paidBranch reads "บึงกาฬ + หนองคาย" for someone who paid
  // into both.
  const csvRows = csvBranch ? shown.filter((m) => m.paidBranch?.includes(csvBranch)) : shown;
  const filtered =
    statusFilter !== "all" ||
    subUnitFilter.length > 0 ||
    hCodeFilter.length > 0 ||
    search !== "";
  // Two different things that both used to read as "ไม่มีเลขบัญชี": nobody
  // has ever recorded an account for this member, and the cooperative holds
  // several and the fill would not pick one. Only the first is unmatchable.
  //
  // Counted through the same rule the chips filter by, or the two disagree:
  // a round just seeded from the ไฟล์รวม, which carries no account numbers
  // at all, read "⛔ ไม่มีเลขบัญชี 6,267" and then showed an empty table when
  // the chip was clicked — because nobody in it is owed anything yet.
  const countMatching = (status: string) =>
    members.filter((m) => matchesStatus(m, status)).length;
  const missingAccountCount = countMatching("no_account");
  const manyAccountsCount = countMatching("many_accounts");
  const cashCount = countMatching("cash");

  const transfersOf = (memberNumber: string) =>
    transfers.filter((t) => t.memberNumber === memberNumber);
  const recordedOutsideOf = (memberNumber: string) =>
    recordedOutside.filter((r) => r.memberNumber === memberNumber);
  // Earlier months this member still owes (ชำระข้ามเดือน), leaving out this
  // round's own debts when it is the closed one being looked at.
  const debtsOf = (memberNumber: string) => {
    const key = memberNumberKey(memberNumber);
    return key
      ? openDebts.filter(
          (d) => d.sourceRoundId !== selectedId && memberNumberKey(d.memberNumber) === key
        )
      : [];
  };
  const owedEarlier = (memberNumber: string) =>
    Math.round(
      debtsOf(memberNumber).reduce((sum, d) => sum + d.amount - d.amountPaid, 0) * 100
    ) / 100;
  // Whether a transfer can still give some of itself to a carried debt:
  // only from an open round, only money the round is still counting, and
  // only once any carried debt exists at all.
  const canCarry = (t: { amount: number; carriedAmount: number; excludedReason?: string | null }) =>
    !selected?.closedAt &&
    openDebts.length > 0 &&
    !t.excludedReason &&
    t.amount - t.carriedAmount > 0.01;
  // A member whose money carries an unresolved hint gets a mark in the table,
  // so the ones worth opening are visible without expanding every row.
  const memberHasHint = (memberNumber: string) =>
    transfers.some((t) => t.memberNumber === memberNumber && t.slipHint && !t.excludedReason);
  const excludedTransfers = transfers.filter((t) => t.excludedReason);
  // The lines this round is counting that another round is counting too.
  const doubleCounted = transfers.filter((t) => t.alsoCountedIn.length > 0);

  // Whether each section is showing its rows, and the one click that changes
  // it. Only the member list is searchable, so the other two keep their
  // default while somebody types rather than folding for want of hits they
  // were never offered — see sectionOpen.
  const isOpen = (key: StatementSectionKey, matches = 0) =>
    sectionOpen(
      {
        clicked: clicked[key],
        searching: STATEMENT_SECTION_SEARCHABLE[key] && search !== "",
        matches,
      },
      STATEMENT_SECTION_OPEN_BY_DEFAULT[key]
    );
  const toggle = (key: StatementSectionKey, matches = 0) =>
    setClicked((prev) => ({ ...prev, [key]: !isOpen(key, matches) }));

  const membersOpen = isOpen("members", shown.length);
  const unmatchedOpen = isOpen("unmatched", unmatched.length);
  const outsideRoundOpen = isOpen("outsideRound", outsideRound.length);

  // The unclaimed list in the order the person asked for. Sorted here rather
  // than in the query because the ordering is a reading of the list, not a
  // property of it, and the repeats ordering counts the rows on screen.
  const shownUnmatched = sortUnmatched(unmatched, unmatchedSort);

  // The answers the daily page already has for rows still on the list of
  // work: the same "ใช้เลขนี้" each row offers, gathered one per account so a
  // member who paid in three times is one binding, not three.
  const recordedBindings = [
    ...new Map(
      unmatched
        .filter((t) => t.recordedAs)
        .map((t) => [
          t.accountNumber,
          {
            accountNumber: t.accountNumber,
            memberNumber: t.recordedAs!.memberNumber,
            memberName: t.recordedAs!.memberName,
            category: t.recordedAs!.category,
          },
        ])
    ).values(),
  ];
  const excludedOpen = isOpen("excluded", excludedTransfers.length);

  const clearFilters = () => {
    setStatusFilter("all");
    setSubUnitFilter([]);
    setHCodeFilter([]);
    setSearchInput("");
    setSearch("");
  };

  // Ticking a หน่วยคุม that a chosen หน่วยคุมย่อย does not belong to would
  // leave a stale pairing behind and an empty table with no obvious cause,
  // so the sub-units drop to the ones still on offer.
  const changeHCode = (next: string[]) => {
    setHCodeFilter(next);
    if (subUnitFilter.length > 0 && next.length > 0) {
      const offered = new Set(subUnitsOf(members, next).map((u) => u.value));
      setSubUnitFilter(subUnitFilter.filter((value) => offered.has(value)));
    }
  };

  // The orderings, in the order they were chosen. Picking one already in the
  // list removes it, so the same control both adds and takes away.
  const toggleSort = (key: StatementSort) =>
    setSort((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-100">
        <div>
          <h2 className="font-semibold">เทียบ Statement (ใครโอนมาแล้วบ้าง)</h2>
          <PanelHelp summary="อัปโหลดรายชื่อหักไม่ได้ + Statement ธนาคารต่อรอบ แล้วระบบจับคู่รายการโอนกับสมาชิกให้เอง ว่าใครชำระครบ/เกิน/ยังค้าง">
            <p>
              ลำดับการทำงาน: <strong>1. อัปโหลดรายการหัก</strong> (ไฟล์ที่ส่งให้หน่วยงาน —
              คอลัมน์ C ยอดแจ้งหัก, I เลขบัญชี) เพื่อตั้งต้นรอบให้รู้ว่าทั้งรอบมีใครบ้าง ·
              <strong> 2. อัปโหลดผลการหัก</strong> เมื่อหน่วยงานส่งกลับมา
              (คอลัมน์ D ยอดหักได้, E ยอดหักไม่ได้) — <strong>ทีละหน่วยได้เลย ไม่ต้องรอครบทั้งสหกรณ์</strong>
              ระบบอัปเดตเฉพาะคนที่อยู่ในไฟล์นั้น ที่เหลือคงไว้ตามเดิม ·
              <strong> 3. อัปโหลด Statement</strong> ของบัญชี 413 หนองคาย / 447 บึงกาฬ
              แล้วระบบจับคู่รายการ "TR fr เลขบัญชี" กับสมาชิกที่หักไม่ได้ให้เอง
            </p>
            <p>
              รอบเก่าที่สร้างไว้ก่อนหน้านี้ยังทำงานแบบเดิมทุกอย่าง — อัปไฟล์ "รวม_ไม่ได้"
              ทั้งก้อนแล้วแทนที่รายชื่อทั้งรอบเหมือนเดิม
            </p>
            <p>
              <strong>Statement อัปโหลดได้หลายไฟล์ต่อบัญชี</strong> (คนละช่วงวันที่) ระบบจะรวมกันให้
              ไม่ทับของเดิม และรายการที่โหลดไว้แล้วจะไม่ถูกนับซ้ำ
              ต่อให้อัปโหลดไฟล์เดิมหรือช่วงวันที่คาบเกี่ยวกัน
            </p>
          </PanelHelp>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fixImplausibleMembers}
            disabled={busy}
            title='ลบแถวสรุป ("รวม", "รวมทั้งสิ้น") ที่ติดเข้ามาเป็นสมาชิกจากไฟล์รายการหักเก่า — ตรวจทุกรอบ ไม่ใช่แค่รอบที่เปิดอยู่'
            className="text-xs text-slate-500 hover:underline disabled:opacity-40 whitespace-nowrap"
          >
            🧹 ลบแถวสรุปที่ติดมาเป็นสมาชิก
          </button>
          <button
            onClick={() => setShowNew((v) => !v)}
            className="text-sm px-3 py-1.5 border border-slate-300 rounded whitespace-nowrap"
          >
            {showNew ? "ยกเลิก" : "+ สร้างรอบใหม่"}
          </button>
        </div>
      </div>

      {showNew && (
        <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50">
          <label className="text-sm">
            <span className="block text-xs text-slate-500 mb-1">รหัสรอบ (MMYY)</span>
            <input
              value={newPeriod}
              onChange={(e) => {
                const period = e.target.value;
                setNewPeriod(period);
                if (!labelTouched) setNewLabel(describeDeductionPeriod(period.trim()));
              }}
              placeholder="0669"
              className="border border-slate-300 rounded px-3 py-1.5 w-28 font-mono"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-slate-500 mb-1">ชื่อรอบ</span>
            <input
              value={newLabel}
              onChange={(e) => {
                setLabelTouched(true);
                setNewLabel(e.target.value);
              }}
              placeholder="มิถุนายน 2569"
              className="border border-slate-300 rounded px-3 py-1.5 w-48"
            />
          </label>
          <button
            onClick={createRound}
            disabled={busy || !newPeriod.trim() || !newLabel.trim()}
            className="text-sm px-3 py-1.5 bg-slate-900 text-white rounded disabled:opacity-50"
          >
            สร้างรอบ
          </button>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2 mx-4 mt-3">{error}</p>
      )}
      {notice && (
        <p className="text-sm text-green-700 bg-green-50 rounded px-3 py-2 mx-4 mt-3">{notice}</p>
      )}

      {loadingRounds ? (
        <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
      ) : rounds.length === 0 ? (
        <p className="text-slate-500 text-sm py-8 text-center">
          ยังไม่มีรอบเทียบ Statement — กด "สร้างรอบใหม่" เพื่อเริ่ม
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-slate-100">
            {rounds.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={`text-sm px-3 py-1.5 rounded border ${
                  r.id === selectedId
                    ? "bg-slate-900 text-white border-slate-900"
                    : "border-slate-300 text-slate-600"
                }`}
              >
                {r.closedAt && <span title="ปิดรอบแล้ว — ยอดค้างอยู่ที่แถบชำระข้ามเดือน">🔒 </span>}
                {r.label}{" "}
                <span className={r.id === selectedId ? "text-slate-300" : "text-slate-400"}>
                  ({r.paidMembers + r.overpaidMembers}/{r.totalMembers})
                </span>
              </button>
            ))}
          </div>

          {selected && (
            <>
              {selected.closedAt ? (
                <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-100 text-sm bg-slate-50">
                  <span className="text-slate-700">
                    🔒 ปิดรอบแล้วเมื่อ {formatStatementDate(selected.closedAt)} — ยอดที่ยังค้างตอนปิดย้ายไปอยู่ที่แถบ{" "}
                    <strong>ชำระข้ามเดือน</strong> แล้ว รอบนี้แก้ไม่ได้อีก (ดูได้อย่างเดียว)
                  </span>
                  <button
                    onClick={reopenRound}
                    disabled={busy}
                    title="ใช้เมื่อปิดรอบผิด — ทำได้เฉพาะตอนที่ยังไม่มีใครชำระหนี้ข้ามเดือนของรอบนี้"
                    className="ml-auto text-slate-600 hover:underline disabled:opacity-50"
                  >
                    เปิดรอบอีกครั้ง
                  </button>
                </div>
              ) : (
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-100 text-sm">
                {/* The order on screen is the order of the month: the list
                    payroll was given, then what each unit could take off it. */}
                <button
                  onClick={() => deductionListInputRef.current?.click()}
                  disabled={busy}
                  title="ไฟล์รายการหักที่ส่งให้หน่วยงาน — ตั้งต้นรอบ รู้ว่าทั้งรอบมีใครบ้าง ยอดเท่าไร และหน่วยไหนยังไม่ส่งผล · อัปทีละเขตได้"
                  className="px-3 py-1.5 border border-slate-300 rounded disabled:opacity-50"
                >
                  1. อัปโหลดรายการหัก
                </button>
                <button
                  onClick={() => membersInputRef.current?.click()}
                  disabled={busy}
                  title="ไฟล์ผลการหักที่หน่วยงานส่งกลับมา — จะเป็นไฟล์รวม_ไม่ได้ทั้งสหกรณ์ หรือไฟล์ของหน่วยเดียวก็ได้"
                  className="px-3 py-1.5 border border-slate-300 rounded disabled:opacity-50"
                >
                  2. อัปโหลดผลการหัก
                </button>
                <span className="text-slate-300">|</span>
                <select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  className="border border-slate-300 rounded px-2 py-1.5"
                >
                  {ACCOUNTS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => statementInputRef.current?.click()}
                  disabled={busy || selected.populationMembers === 0}
                  title={
                    selected.populationMembers === 0
                      ? "อัปโหลดรายการหัก หรือผลการหัก เข้ารอบก่อน"
                      : undefined
                  }
                  className="px-3 py-1.5 border border-slate-300 rounded disabled:opacity-50"
                >
                  อัปโหลด Statement
                </button>
                <button
                  onClick={recomputeRound}
                  disabled={busy}
                  title="คำนวณยอดโอนมาแล้วและสถานะของทุกคนใหม่ จากรายการโอนที่รอบนี้มีอยู่ — ใช้เมื่อยอดในตารางดูไม่ตรงกับรายการโอน"
                  className="ml-auto px-3 py-1.5 border border-slate-300 rounded disabled:opacity-50"
                >
                  🔄 คำนวณยอดใหม่
                </button>
                <button
                  onClick={() => setPendingClose(true)}
                  disabled={busy || selected.populationMembers === 0}
                  title="สิ้นเดือน: ล็อกรอบนี้ แล้วยกยอดที่ยังค้างไปตั้งเป็นหนี้ที่แถบชำระข้ามเดือน"
                  className="px-3 py-1.5 border border-slate-300 rounded disabled:opacity-50"
                >
                  🔒 ปิดรอบ
                </button>
                <button
                  onClick={() => setPendingDelete(selected)}
                  className="text-red-600 hover:underline"
                >
                  ลบรอบนี้
                </button>
              </div>
              )}

              {selected.awaitingMembers > 0 && (
                <div className="px-4 py-2 border-b border-slate-100">
                  <p className="text-sm text-amber-800 bg-amber-50 rounded px-3 py-2">
                    ⏳ รอบนี้ยัง<strong>ไม่ครบทั้งสหกรณ์</strong> — มี{" "}
                    <strong className="num">{selected.awaitingUnits}</strong> หน่วยคุม (
                    <strong className="num">{selected.awaitingMembers}</strong> คน ยอดแจ้งหัก{" "}
                    {formatAmount(selected.awaitingAmount)}) ที่ยัง
                    <strong>ไม่ส่งผลการหักกลับมา</strong>
                    {selected.awaitingResult > 0 ? (
                      // Seeded from the รายการหัก: these members are in the
                      // round, marked รอผลการหัก, and the round can say who
                      // they are — which is the whole point of putting the
                      // list in first.
                      <>
                        {" "}
                        — อยู่ในตารางข้างล่างแล้ว ติดป้าย{" "}
                        <strong>⏳ รอผลการหัก</strong> (ยังไม่นับเป็นยอดค้าง เพราะยังไม่รู้ว่าหักได้หรือไม่ได้)
                        · พอหน่วยไหนส่งผลมา กด <strong>"2. อัปโหลดผลการหัก"</strong> ทีละหน่วยได้เลย
                        ไม่ต้องรอรวมทั้งสหกรณ์
                      </>
                    ) : (
                      <>
                        {" "}
                        ในไฟล์รายชื่อ คนกลุ่มนี้จึงยังไม่อยู่ในตารางข้างล่าง
                        (ยังไม่รู้ว่าหักได้หรือไม่ได้ ถ้านับเป็น "ยังค้าง" ไปเลยจะกลายเป็นทวงเงินคนที่อาจจะหักได้แล้ว) —
                        พอหน่วยงานส่งผลมาครบแล้วให้อัปโหลดไฟล์รายชื่อใหม่ ตัวเลขจะอัปเดตให้เอง
                      </>
                    )}
                  </p>
                </div>
              )}

              {statements.length > 0 && (
                <div className="px-4 py-2 border-b border-slate-100 text-xs text-slate-600">
                  <button
                    type="button"
                    onClick={() => setShowStatementFiles((v) => !v)}
                    className="text-slate-600 hover:underline"
                  >
                    {showStatementFiles ? "▾" : "▸"} ไฟล์ Statement ที่อัปไว้ในรอบนี้ (
                    {statements.filter((s) => !s.bridged).length} ไฟล์)
                  </button>
                  <span className="text-slate-400">
                    {" "}
                    — อัปโหลดเพิ่มได้เรื่อยๆ รายการที่มีอยู่แล้วจะไม่ถูกนับซ้ำ
                  </span>
                  {showStatementFiles && (
                    <div className="mt-2 bg-slate-50 rounded px-2 py-2">
                      <p className="text-xs text-slate-500 mb-2">
                        ทุกไฟล์ที่อัปเข้ารอบนี้ แยกตามบัญชี — ลบได้ถ้าอัปผิดไฟล์หรือผิดบัญชี
                        (ลบเฉพาะรายการโอนที่อ่านจากไฟล์นั้นในรอบนี้ ไม่กระทบไฟล์อื่น
                        และไม่ลบบรรทัดในหน้าเงินเข้าประจำวัน) · อัปไฟล์เดิมกลับเข้าไปได้เสมอ
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="text-slate-500 text-left text-xs uppercase tracking-wide">
                            <tr>
                              <th className="px-2 py-1.5 font-semibold">บัญชี</th>
                              <th className="px-2 py-1.5 font-semibold">ไฟล์</th>
                              <th className="px-2 py-1.5 font-semibold">ช่วงวันที่</th>
                              <th className="px-2 py-1.5 font-semibold text-right">รายการ</th>
                              <th className="px-2 py-1.5 font-semibold text-right">ยอดรวม</th>
                              <th className="px-2 py-1.5 font-semibold"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {statements.map((s) => (
                              <tr
                                key={`${s.account}-${s.sourceFile ?? ""}-${s.bridged}`}
                                className="border-t border-slate-200"
                              >
                                <td className="px-2 py-1.5 whitespace-nowrap">
                                  <span className="num">{s.account}</span> {s.branch}
                                </td>
                                <td className="px-2 py-1.5">
                                  {s.bridged ? (
                                    <span
                                      className="text-sky-700"
                                      title="รายการที่บันทึกจากหน้าเงินเข้าประจำวันแล้วเชื่อมเข้ารอบ — ไม่ได้อัปเข้ารอบนี้โดยตรง ถ้าจะเอาออกให้ลบรายการที่บันทึกไว้ที่หน้านั้น"
                                    >
                                      🔗 เชื่อมจากหน้าเงินเข้าประจำวัน
                                    </span>
                                  ) : (
                                    s.sourceFile ?? <span className="text-slate-400">(ไม่ทราบชื่อไฟล์)</span>
                                  )}
                                </td>
                                <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">
                                  {s.from ? formatStatementDate(s.from) : "—"}
                                  {s.to && s.from !== s.to && ` – ${formatStatementDate(s.to)}`}
                                </td>
                                <td className="px-2 py-1.5 num text-right">{s.transfers}</td>
                                <td className="px-2 py-1.5 num text-right">{formatAmount(s.amount)}</td>
                                <td className="px-2 py-1.5 whitespace-nowrap text-right">
                                  {!s.bridged && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setPendingClear({
                                          account: s.account,
                                          branch: s.branch || (STATEMENT_BRANCH[s.account] ?? ""),
                                          file: { name: s.sourceFile, transfers: s.transfers },
                                        })
                                      }
                                      disabled={busy || frozen}
                                      className="text-xs text-red-700 hover:underline disabled:opacity-40"
                                    >
                                      ลบไฟล์นี้
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">
                        ล้างทั้งบัญชี (ทุกไฟล์):
                        {ACCOUNTS.filter((a) => statements.some((s) => s.account === a.value)).map(
                          (a) => (
                            <button
                              key={a.value}
                              type="button"
                              onClick={() =>
                                setPendingClear({
                                  account: a.value,
                                  branch: STATEMENT_BRANCH[a.value] ?? "",
                                })
                              }
                              disabled={busy || frozen}
                              className="text-red-600 hover:underline ml-2 disabled:opacity-40"
                            >
                              ล้าง {a.value}
                            </button>
                          )
                        )}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* These read as buttons now rather than a row of words: which
                  one is active was previously only a bold weight, which is
                  hard to see when every label already carries an emoji. */}
              <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-100 text-sm">
                <FilterChip
                  active={statusFilter === "all"}
                  onClick={() => setStatusFilter("all")}
                  label="ทั้งหมด"
                  count={selected.populationMembers || selected.totalMembers}
                  suffix="คน"
                  title="ทุกคนที่อยู่ในรอบนี้ — รวมคนที่รอผลการหักและคนที่หักได้ครบแล้ว"
                />
                {/* Only on a round that was started from the รายการหัก. On an
                    old round both are zero and the chips stay out of the way. */}
                {selected.awaitingResult > 0 && (
                  <FilterChip
                    active={statusFilter === "awaiting"}
                    onClick={() =>
                      setStatusFilter(statusFilter === "awaiting" ? "all" : "awaiting")
                    }
                    label="⏳ รอผลการหัก"
                    count={selected.awaitingResult}
                    countClass="text-slate-600"
                    title="อยู่ในรายการหัก แต่หน่วยงานยังไม่ส่งผลกลับมาว่าหักได้หรือไม่ได้"
                  />
                )}
                {selected.collectedMembers > 0 && (
                  <FilterChip
                    active={statusFilter === "collected"}
                    onClick={() =>
                      setStatusFilter(statusFilter === "collected" ? "all" : "collected")
                    }
                    label="✅ หักได้ครบ"
                    count={selected.collectedMembers}
                    countClass="text-slate-500"
                    title="หน่วยงานหักเงินเดือนได้ครบแล้ว ไม่มีอะไรต้องตามในรอบนี้"
                  />
                )}
                <FilterChip
                  active={statusFilter === "uncollected"}
                  onClick={() =>
                    setStatusFilter(statusFilter === "uncollected" ? "all" : "uncollected")
                  }
                  label="หักไม่ได้"
                  count={selected.totalMembers}
                  suffix="คน"
                  title="คนที่หักเงินเดือนไม่ได้ — คือกลุ่มที่ต้องตามเก็บในรอบนี้ ตัวเลขข้างล่างทั้งหมดพูดถึงกลุ่มนี้"
                />
                <FilterChip
                  active={statusFilter === "paid"}
                  onClick={() => setStatusFilter(statusFilter === "paid" ? "all" : "paid")}
                  label="✅ ชำระครบ"
                  count={selected.paidMembers}
                  countClass="text-green-700"
                />
                <FilterChip
                  active={statusFilter === "overpaid"}
                  onClick={() => setStatusFilter(statusFilter === "overpaid" ? "all" : "overpaid")}
                  label="⚠️ ชำระเกิน"
                  count={selected.overpaidMembers}
                  countClass="text-amber-700"
                />
                <FilterChip
                  active={statusFilter === "unpaid"}
                  onClick={() => setStatusFilter(statusFilter === "unpaid" ? "all" : "unpaid")}
                  label="❌ ยังค้าง"
                  count={selected.unpaidMembers}
                  countClass="text-red-600"
                />
                {cashCount > 0 && (
                  <FilterChip
                    active={statusFilter === "cash"}
                    onClick={() => setStatusFilter(statusFilter === "cash" ? "all" : "cash")}
                    label="💵 จ่ายเงินสด"
                    count={cashCount}
                    countClass="text-sky-700"
                    title="มีอย่างน้อยหนึ่งรายการที่บันทึกว่าจ่ายเป็นเงินสด ไม่ใช่จากไฟล์ Statement"
                  />
                )}
                {manyAccountsCount > 0 && (
                  <FilterChip
                    active={statusFilter === "many_accounts"}
                    onClick={() =>
                      setStatusFilter(statusFilter === "many_accounts" ? "all" : "many_accounts")
                    }
                    label="มีหลายเลขบัญชี"
                    count={manyAccountsCount}
                    countClass="text-slate-600"
                    title="ทะเบียนมีมากกว่าหนึ่งเลขบัญชีของสมาชิกคนนี้ ระบบจึงไม่เลือกให้ — เงินที่โอนมาจากบัญชีไหนก็ยังจับคู่ได้ตามปกติ"
                  />
                )}
                {missingAccountCount > 0 && (
                  <FilterChip
                    active={statusFilter === "no_account"}
                    onClick={() =>
                      setStatusFilter(statusFilter === "no_account" ? "all" : "no_account")
                    }
                    label="⛔ ไม่มีเลขบัญชี"
                    count={missingAccountCount}
                    countClass="text-amber-700"
                    title="ไม่มีเลขบัญชีทั้งในไฟล์รายชื่อ ทะเบียน และรอบก่อนหน้า — จับคู่กับ Statement ไม่ได้เลย ต้องหาเลขบัญชีมาเติมก่อน"
                  />
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-100 text-sm">
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="ค้นหาชื่อ, เลขสมาชิก, เลขบัญชี"
                  className="border border-slate-300 rounded-md px-3 py-1.5 w-64 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
                />
                {/* The two levels, filtered separately: the หน่วยคุม the
                    chasing up is divided by (คอลัมน์ G ของไฟล์รวม), and the
                    school or office inside it (D และ E). */}
                {hCodes.length > 0 && (
                  <MultiSelect
                    options={hCodes.map((h) => ({ value: h, label: unitLabel(h) }))}
                    selected={hCodeFilter}
                    onChange={changeHCode}
                    allLabel="ทุกหน่วยคุม"
                    searchPlaceholder="ค้นหาหน่วยคุม"
                    title="หน่วยคุม — หน่วยที่สรุปหน่วยคุมของสหกรณ์นับตาม (คอลัมน์ G ของไฟล์รวม) · ติ๊กได้หลายหน่วย"
                    className="max-w-[14rem]"
                  />
                )}
                <MultiSelect
                  options={subUnits.map((u) => ({ value: u.value, label: u.label }))}
                  selected={subUnitFilter}
                  onChange={setSubUnitFilter}
                  allLabel={
                    hCodeFilter.length > 0
                      ? `ทุกหน่วยคุมย่อยใน ${hCodeFilter.length} หน่วยคุม`
                      : "ทุกหน่วยคุมย่อย"
                  }
                  searchPlaceholder="ค้นหารหัสหรือชื่อสังกัด"
                  title="หน่วยคุมย่อย — รหัสและชื่อสังกัด (คอลัมน์ D และ E ของไฟล์รวม) · ติ๊กได้หลายสังกัด"
                  className="max-w-[18rem]"
                />
                {/* Several orderings, applied in the order they were chosen,
                    because "หน่วยคุม แล้วยอดค้างมากก่อน" is one question and
                    a single ordering could not ask it. */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-slate-500">เรียง</span>
                  {sort.map((key, index) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleSort(key)}
                      title="เอาการเรียงนี้ออก"
                      className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 pl-2 pr-1.5 py-0.5 text-xs hover:bg-slate-100"
                    >
                      <span className="num text-slate-400">{index + 1}</span>
                      {SORT_OPTIONS.find((o) => o.value === key)?.label ?? key}
                      <span className="text-slate-400">✕</span>
                    </button>
                  ))}
                  {sort.length < SORT_OPTIONS.length && (
                    <select
                      value=""
                      onChange={(e) => toggleSort(e.target.value as StatementSort)}
                      className="border border-slate-300 rounded-md px-2 py-1 bg-white text-xs"
                    >
                      <option value="">+ เพิ่มการเรียง</option>
                      {SORT_OPTIONS.filter((o) => !sort.includes(o.value)).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {sort.length === 0 && (
                    <span className="text-xs text-slate-400">ตามลำดับของระบบ (ยังค้างขึ้นก่อน)</span>
                  )}
                </div>
                {filtered && (
                  <button onClick={clearFilters} className="text-slate-500 hover:underline">
                    ล้างตัวกรอง
                  </button>
                )}
                <select
                  value={csvBranch}
                  onChange={(e) => setCsvBranch(e.target.value as typeof csvBranch)}
                  className="ml-auto border border-slate-300 rounded-md px-2 py-1.5 bg-white text-sm"
                  title='กรองไฟล์ CSV ตามบัญชีที่สมาชิกโอนเข้าจริง (413 หนองคาย / 447 บึงกาฬ) — คนที่ยังไม่ได้โอนเลยจะไม่อยู่ในไฟล์ของบัญชีใดบัญชีหนึ่ง อยู่ใน "รวม" เท่านั้น'
                >
                  <option value="">รวม</option>
                  <option value="หนองคาย">413 หนองคาย</option>
                  <option value="บึงกาฬ">447 บึงกาฬ</option>
                </select>
                <button
                  onClick={() => downloadStatementMembersCsv(csvRows, selected.label, unitNames)}
                  disabled={csvRows.length === 0}
                  className="px-3 py-1.5 border border-slate-300 rounded-md bg-white hover:bg-slate-50 disabled:opacity-40"
                >
                  ส่งออก CSV ({csvRows.length})
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-4 px-4 py-2 border-b border-slate-100 text-sm bg-slate-50">
                {/* Totals follow the filters: with a สังกัด picked, "ยอดค้าง" of
                    that unit is the number staff are about to act on, not the
                    round-wide one. */}
                <span className="num text-slate-500">
                  {filtered ? `แสดง ${shownTotals.count} จาก ${members.length} คน` : `${members.length} คน`}
                </span>
                <span className="text-slate-500">
                  ยอดหักไม่ได้{" "}
                  <strong className="num font-semibold text-slate-900">
                    {formatAmount(shownTotals.due)}
                  </strong>
                </span>
                <span className="text-slate-500">
                  โอนมาแล้ว{" "}
                  <strong className="num font-semibold text-green-700">
                    {formatAmount(shownTotals.paid)}
                  </strong>
                </span>
                <span className="text-slate-500">
                  คงเหลือ{" "}
                  <strong
                    className={`num font-semibold ${
                      shownTotals.outstanding > 0 ? "text-red-600" : "text-slate-900"
                    }`}
                  >
                    {formatAmount(shownTotals.outstanding)}
                  </strong>
                </span>
                {filtered && (
                  <span className="num text-slate-400">
                    (ทั้งรอบ: คงเหลือ {formatAmount(totals.outstanding)})
                  </span>
                )}
                {/* Folding three tables of this size one heading at a time is
                    its own chore when the answer is "show me everything" or
                    "get all of it out of the way". Pushed right so it reads
                    as a control over the page, not as part of the figures. */}
                <span className="ml-auto flex items-center gap-2 text-xs">
                  <button
                    onClick={() => setClicked(allStatementSections(true))}
                    className="text-slate-500 hover:underline"
                  >
                    ขยายทั้งหมด
                  </button>
                  <span className="text-slate-300">·</span>
                  <button
                    onClick={() => setClicked(allStatementSections(false))}
                    className="text-slate-500 hover:underline"
                  >
                    ย่อทั้งหมด
                  </button>
                </span>
              </div>
            </>
          )}

          {/* Said at the top, because the flag itself lives on a transfer row
              inside a member's expanded detail — nobody would find it by
              looking. This is money counted twice, so it belongs beside the
              totals it is wrong about. */}
          {doubleCounted.length > 0 && (
            <div className="px-4 py-2.5 border-t border-slate-100 bg-red-50 text-sm text-red-800">
              🔁 มี <strong className="num">{doubleCounted.length}</strong> รายการโอนที่ถูกนับเป็นการชำระ
              <strong>ในรอบอื่นด้วย</strong> — เงินก้อนเดียวกันนับสองรอบ ยอดที่จ่ายแล้วของรอบนี้จึงสูงเกินจริง
              <span className="block text-xs mt-1">
                เกิดจากการอัป Statement ไฟล์เดียวเข้าหลายรอบ (ซึ่งจำเป็นเวลาไล่คนจ่ายช้า) ·
                กดดูสมาชิกเลข{" "}
                <strong className="num">
                  {[...new Set(doubleCounted.map((t) => t.memberNumber))]
                    .filter(Boolean)
                    .slice(0, 8)
                    .join(", ")}
                  {new Set(doubleCounted.map((t) => t.memberNumber)).size > 8 && " …"}
                </strong>{" "}
                แล้วเลือก <strong>"ชำระของรอบอื่น"</strong> ในรอบที่เงินก้อนนั้นไม่ได้จ่ายให้
              </span>
            </div>
          )}

          {loadingRound ? (
            <p className="text-slate-500 text-sm py-8 text-center">กำลังโหลด…</p>
          ) : members.length === 0 ? (
            <p className="text-slate-500 text-sm py-8 text-center">
              ยังไม่มีรายชื่อในรอบนี้ — กด "อัปโหลดรายชื่อหักไม่ได้" เพื่อเริ่ม
            </p>
          ) : shown.length === 0 ? (
            <p className="text-slate-500 text-sm py-8 text-center">
              ไม่มีใครตรงกับตัวกรองนี้ —{" "}
              <button onClick={clearFilters} className="text-slate-900 hover:underline">
                ล้างตัวกรอง
              </button>
            </p>
          ) : (
            <>
              {/* The heading is the control. This table is the round itself —
                  1,173 rows on a real one — and it sits above the two lists
                  staff work through by hand, so reaching them meant scrolling
                  past the whole thing, again after every save. */}
              <div className="px-4 pt-3">
                <button
                  onClick={() => toggle("members", shown.length)}
                  aria-expanded={membersOpen}
                  className="text-sm font-semibold text-slate-700 hover:underline"
                >
                  {membersOpen ? "▾" : "▸"} รายชื่อหักไม่ได้รอบนี้ (
                  <span className="num">{shown.length}</span>
                  {filtered && (
                    <>
                      {" จาก "}
                      <span className="num">{members.length}</span>
                    </>
                  )}{" "}
                  คน)
                </button>
              </div>
              {membersOpen && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[1240px]">
                    {/* The header sticks because these rounds run to hundreds of
                        rows and the columns are otherwise indistinguishable once
                        it scrolls away — four of them are money.

                        Names and สังกัด carry minimum widths because Thai has no
                        spaces between words: squeezed into a narrow column the
                        browser breaks them mid-word, and a member's name split
                        across three lines is hard to match against a list. */}
                    <thead className="sticky top-0 z-10 bg-slate-100 text-slate-600 text-left text-xs uppercase tracking-wide">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">เลขสมาชิก</th>
                        <th className="px-4 py-2.5 font-semibold min-w-[13rem]">ชื่อ-สกุล</th>
                        <th className="px-4 py-2.5 font-semibold min-w-[12rem]">หน่วยคุม · สังกัด</th>
                        <th className="px-4 py-2.5 font-semibold">เลขบัญชี</th>
                        <th className="px-4 py-2.5 font-semibold text-right">ยอดหักไม่ได้</th>
                        <th className="px-4 py-2.5 font-semibold text-right">โอนมาแล้ว</th>
                        <th className="px-4 py-2.5 font-semibold text-right">ส่วนต่าง</th>
                        <th className="px-4 py-2.5 font-semibold">วันเวลาที่โอน</th>
                        <th className="px-4 py-2.5 font-semibold">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((m) => {
                        const diff = memberDifference(m);
                        return (
                          <Fragment key={m.id}>
                          <tr className="border-t border-slate-100 hover:bg-slate-50/75">
                            <td className="px-4 py-2.5 num whitespace-nowrap">{m.memberNumber}</td>
                            <td className="px-4 py-2.5">
                              {m.name}
                              {m.note && (
                                <span className="text-xs text-slate-400"> · {m.note}</span>
                              )}
                              {/* A member who pays this month may also owe an
                                  earlier one. Which debt a transfer settles is
                                  staff's call — this only says there is a
                                  choice to make. */}
                              {owedEarlier(m.memberNumber) > 0 && (
                                <span
                                  className="block text-xs text-amber-700"
                                  title={debtsOf(m.memberNumber)
                                    .map((d) => `${d.sourceLabel} ค้าง ${formatAmount(d.amount - d.amountPaid)}`)
                                    .join(" · ")}
                                >
                                  ⚠️ ค้างข้ามเดือน {formatAmount(owedEarlier(m.memberNumber))}
                                </span>
                              )}
                            </td>
                            {/* The หน่วยคุม and the สังกัด under it, in one
                                column: a code on its own says nothing to
                                anybody reading the table, and the two were
                                never worth the width of two columns. */}
                            <td className="px-4 py-2.5">
                              {m.hCode && (
                                <span
                                  className="num text-slate-400 mr-1.5"
                                  title={unitLabel(m.hCode)}
                                >
                                  {m.hCode}
                                </span>
                              )}
                              {m.unitName ?? (m.hCode ? "" : "—")}
                              {m.unitCode && (
                                <span className="num text-xs text-slate-400"> · {m.unitCode}</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs">
                              {m.accountNumber ? (
                                <>
                                  {m.accountNumber}
                                  {/* Other accounts the directory holds for
                                      them — money from any of them still
                                      finds this member. */}
                                  {(m.knownAccounts ?? []).filter((a) => a !== m.accountNumber).length > 0 && (
                                    <span
                                      className="block font-sans text-[11px] text-slate-400"
                                      title={(m.knownAccounts ?? []).join(" · ")}
                                    >
                                      + อีก{" "}
                                      {(m.knownAccounts ?? []).filter((a) => a !== m.accountNumber).length}{" "}
                                      บัญชี:{" "}
                                      <span className="font-mono">
                                        {(m.knownAccounts ?? [])
                                          .filter((a) => a !== m.accountNumber)
                                          .join(" · ")}
                                      </span>
                                    </span>
                                  )}
                                </>
                              ) :
                                // Blank because the cooperative holds more
                                // than one account for this member and the
                                // fill will not choose between them. Saying
                                // "ไม่มีเลขบัญชี" here sent staff looking for
                                // a number that was on file twice over — and
                                // money from either account still finds them
                                // through the directory.
                                ((m.knownAccounts?.length ?? 0) > 1 ? (
                                  <span className="font-sans text-slate-500">
                                    มี{" "}
                                    <strong className="num">{m.knownAccounts!.length}</strong>{" "}
                                    เลขบัญชี
                                    <span className="block font-mono text-[11px] text-slate-400">
                                      {m.knownAccounts!.join(" · ")}
                                    </span>
                                  </span>
                                ) : (
                                  <span className="font-sans text-amber-700">ไม่มีเลขบัญชี</span>
                                ))}
                            </td>
                            <td className="px-4 py-2.5 num text-right whitespace-nowrap">
                              {m.deductionResult === "uncollected" ? (
                                formatAmount(m.amountDue)
                              ) : m.amountDue < 0 ? (
                                // หักเกิน: payroll took more than was asked. Shown
                                // as the sheet has it, and counted in the
                                // totals, so they add up to the sheet's own.
                                <span className="text-amber-700" title="หักเงินเดือนเกินกว่ายอดที่แจ้งหัก">
                                  {formatAmount(m.amountDue)}
                                  <span className="block text-xs">หักเกิน</span>
                                </span>
                              ) : (
                                // Nothing is owed on this row — but the round
                                // does know what payroll was asked to take,
                                // and on a member still marked รอผลการหัก
                                // that figure is the only number there is.
                                <span className="text-slate-400">
                                  {m.expectedAmount != null
                                    ? `แจ้งหัก ${formatAmount(m.expectedAmount)}`
                                    : "—"}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 num text-right whitespace-nowrap">
                              {/* Reachable even at ฿0: a member with no bank
                                  transfer yet is exactly who still needs the
                                  "บันทึกว่าจ่ายเงินสดแล้ว" button — gating
                                  this on amountPaid > 0 would hide it from
                                  everyone who has not paid by transfer,
                                  which is most of a round. */}
                              <button
                                onClick={() =>
                                  setExpandedMember(
                                    expandedMember === m.memberNumber ? null : m.memberNumber
                                  )
                                }
                                className="hover:underline"
                                title="ดูรายการโอนของคนนี้ / ระบุว่าเงินก้อนไหนไม่ใช่ค่าหักไม่ได้ / บันทึกเงินสด"
                              >
                                {m.amountPaid > 0 ? formatAmount(m.amountPaid) : "—"}
                                {memberHasHint(m.memberNumber) && (
                                  <span className="text-amber-600" title="อาจเป็นเงินที่โอนมาด้วยเหตุผลอื่น">
                                    {" "}⚠️
                                  </span>
                                )}
                              </button>
                            </td>
                            <td
                              className={`px-4 py-2.5 num text-right whitespace-nowrap ${
                                diff < 0
                                  ? "text-red-600 font-medium"
                                  : diff > 0
                                    ? "text-amber-700 font-medium"
                                    : "text-slate-400"
                              }`}
                            >
                              {diff === 0 ? "0" : formatAmount(diff)}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
                              {m.paidAt ? <DateTimeCell iso={m.paidAt} suffix={m.paidBranch} /> : "—"}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap">
                              <span
                                className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium border ${
                                  STATUS_CLASS[m.status] ?? STATUS_CLASS.unpaid
                                }`}
                              >
                                {STATUS_LABEL[m.status] ?? m.status}
                              </span>
                            </td>
                          </tr>

                          {expandedMember === m.memberNumber && (
                            <tr className="bg-slate-50">
                              <td colSpan={9} className="px-4 py-2">
                                <p className="text-xs text-slate-500 mb-1">
                                  รายการโอนของ {m.name} — ถ้าก้อนไหน<strong>ไม่ใช่</strong>เงินจ่ายค่าหักไม่ได้
                                  (ซื้อหุ้น / ชำระหนี้ / ฝากเงิน ฯลฯ) เลือกเหตุผลไว้ ระบบจะไม่นับเป็นการชำระ
                                </p>
                                {transfersOf(m.memberNumber).map((t) => (
                                  <div
                                    key={t.id}
                                    className="flex flex-wrap items-center gap-3 text-sm py-1 border-t border-slate-200"
                                  >
                                    <span className="num whitespace-nowrap font-medium">
                                      {formatAmount(t.amount)}
                                    </span>
                                    <span className="num text-slate-500 whitespace-nowrap">
                                      {formatStatementDateTime(t.transferredAt)}
                                    </span>
                                    <span className="font-mono text-xs text-slate-400">
                                      {t.accountNumber}
                                    </span>
                                    {t.slipHint && !t.excludedReason && (
                                      <span className="text-xs text-amber-700">
                                        ⚠️ อาจเป็น <strong>{t.slipHint.category}</strong>{" "}
                                        {formatAmount(t.slipHint.amount)} (สมาชิกส่งสลิป{" "}
                                        {formatStatementDate(t.slipHint.date)})
                                      </span>
                                    )}
                                    {/* One payment settling two months at once.
                                        Louder than the slip hint because this one
                                        is arithmetic, not a guess: the money is
                                        counted twice until somebody says which
                                        month it was for. */}
                                    {t.alsoCountedIn.length > 0 && (
                                      <span
                                        className="text-xs text-red-700"
                                        title={
                                          "เงินก้อนเดียวกันนี้ถูกนับเป็นการชำระในรอบอื่นด้วย — " +
                                          "รวมแล้วนับซ้ำ ถ้ารู้ว่าจ่ายของเดือนไหน " +
                                          'ให้เลือก "ชำระของรอบอื่น" ในรอบที่ไม่ใช่'
                                        }
                                      >
                                        🔁 {describeDoubleCount(t.alsoCountedIn)}
                                      </span>
                                    )}
                                    {/* A row whose memberNumber staff set by
                                        hand rather than one read off the
                                        account — the other half of a split,
                                        a whole transfer moved outright, or a
                                        cash payment that was never a bank
                                        line to begin with. */}
                                    {t.setAside ? (
                                      <span
                                        className="text-xs text-violet-700"
                                        title="ส่วนนี้ตัดออกจากยอดโอนก้อนเดียวกัน ไม่นับในรอบ และบันทึกเป็นรายการของสมาชิกที่แถบธุรกรรมแล้ว"
                                      >
                                        ✂️ ตัดออกจากยอดโอน · บันทึกเป็น <strong>{t.excludedReason}</strong>
                                      </span>
                                    ) : t.splitFrom ? (
                                      // A share of one bank line: say whose
                                      // line, so it does not read as money
                                      // arriving from nowhere.
                                      <span
                                        className="text-xs text-sky-700"
                                        title={`ส่วนของสมาชิกคนนี้จากยอดที่โอนมาก้อนเดียว ${formatAmount(t.splitFrom.total)} ซึ่งเจ้าหน้าที่แบ่งให้ ${t.splitFrom.memberCount} คน`}
                                      >
                                        🏢 แบ่งจาก{" "}
                                        <strong>
                                          {t.splitFrom.payerName ??
                                            (t.splitFrom.fromAccount ? `บัญชี ${t.splitFrom.fromAccount}` : "ยอดโอนก้อนเดียว")}
                                        </strong>{" "}
                                        · ยอดรวม {formatAmount(t.splitFrom.total)} ({t.splitFrom.memberCount} คน)
                                      </span>
                                    ) : t.manualMemberNumber && t.accountNumber === "เงินสด" ? (
                                      <span className="text-xs text-sky-700" title="ไม่มีบรรทัดในสเตทเมนต์ธนาคาร — บันทึกตรงจากหน้านี้">
                                        💵 เงินสด
                                      </span>
                                    ) : (
                                      t.manualMemberNumber && (
                                        <span
                                          className="text-xs text-sky-700"
                                          title="เลขสมาชิกของรายการนี้ถูกระบุเองโดยเจ้าหน้าที่ ไม่ใช่จับคู่จากเลขบัญชี — จะไม่ถูกจับคู่ทับตอนอัป Statement รอบถัดไป"
                                        >
                                          🔀 ย้ายมาให้คนนี้
                                        </span>
                                      )
                                    )}
                                    {t.carriedAmount > 0 && (
                                      <span
                                        className="text-xs text-amber-700"
                                        title='ส่วนนี้ไม่นับในรอบนี้ — นับเป็นการชำระหนี้ข้ามเดือนแทน ย้อนกลับได้ที่แถบ "ชำระข้ามเดือน"'
                                      >
                                        ↪ ชำระข้ามเดือน {formatAmount(t.carriedAmount)}
                                      </span>
                                    )}
                                    {t.setAside ? (
                                    <span className="ml-auto flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => restoreAside(t.id)}
                                        disabled={busy || frozen}
                                        className="text-xs text-slate-600 border border-slate-300 rounded px-2 py-1 hover:bg-slate-50 disabled:opacity-50"
                                        title="ตัดผิด — รวมยอดนี้กลับเข้ารายการโอนเดิม และลบรายการที่บันทึกไว้ในแถบธุรกรรม"
                                      >
                                        รวมกลับ
                                      </button>
                                    </span>
                                    ) : (
                                    <span className="ml-auto flex items-center gap-2">
                                      <select
                                        value={t.excludedReason ?? ""}
                                        onChange={(e) =>
                                          setTransferReason(t.id, e.target.value || null)
                                        }
                                        disabled={busy || frozen}
                                        className={`border rounded px-2 py-1 text-xs ${
                                          t.excludedReason
                                            ? "border-amber-300 bg-amber-50"
                                            : "border-slate-300"
                                        }`}
                                      >
                                        <option value="">นับเป็นจ่ายค่าหักไม่ได้</option>
                                        {EXCLUDE_REASONS.map((r) => (
                                          <option key={r} value={r}>
                                            ไม่เกี่ยวกับรอบนี้ — {r}
                                          </option>
                                        ))}
                                      </select>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          splittingTransfer === t.id ? closeSplit() : openSplit(t)
                                        }
                                        disabled={busy || frozen}
                                        className="text-xs text-slate-600 border border-slate-300 rounded px-2 py-1 hover:bg-slate-50 disabled:opacity-50"
                                        title="เงินก้อนนี้รวมของสมาชิกคนอื่นไว้ด้วย — ระบุได้ว่าจะย้ายเท่าไหร่ไปให้ใคร"
                                      >
                                        {splittingTransfer === t.id ? "ยกเลิกแบ่งยอด" : "แบ่งให้สมาชิกอื่น"}
                                      </button>
                                      {canCarry(t) && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setCarryingTransfer(carryingTransfer === t.id ? null : t.id)
                                          }
                                          disabled={busy}
                                          className="text-xs text-amber-800 border border-amber-300 rounded px-2 py-1 hover:bg-amber-50 disabled:opacity-50"
                                          title="เงินก้อนนี้จ่ายหนี้ของเดือนก่อนที่ปิดรอบไปแล้ว — ย้ายไปนับที่แถบชำระข้ามเดือน"
                                        >
                                          {carryingTransfer === t.id ? "ยกเลิก" : "ชำระข้ามเดือน"}
                                        </button>
                                      )}
                                      {!t.excludedReason && t.memberNumber && t.amount - t.carriedAmount > 0.005 && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            asideTransfer === t.id ? setAsideTransfer(null) : openAside(t)
                                          }
                                          disabled={busy || frozen}
                                          className="text-xs text-violet-800 border border-violet-300 rounded px-2 py-1 hover:bg-violet-50 disabled:opacity-50"
                                          title="เงินก้อนนี้มีเงินอื่นรวมมาด้วย เช่น สสค — ตัดส่วนนั้นออกจากรอบ แล้วบันทึกเป็นรายการของสมาชิก"
                                        >
                                          {asideTransfer === t.id ? "ยกเลิก" : "✂️ ตัดยอดออก"}
                                        </button>
                                      )}
                                    </span>
                                    )}
                                    {asideTransfer === t.id && (
                                      <div className="w-full flex flex-wrap items-center gap-2 pt-1 pl-1 border-t border-dashed border-slate-200 mt-1">
                                        <span className="text-xs text-slate-500">ตัดออก</span>
                                        <input
                                          type="number"
                                          inputMode="decimal"
                                          step="0.01"
                                          value={asideAmount}
                                          onChange={(e) => setAsideAmount(e.target.value)}
                                          placeholder="เช่น 390"
                                          className="border border-slate-300 rounded px-2 py-1 text-xs w-24"
                                          autoFocus
                                        />
                                        <span className="text-xs text-slate-500">บาท บันทึกเป็น</span>
                                        <select
                                          value={asideCategory}
                                          onChange={(e) => setAsideCategory(e.target.value)}
                                          className="border border-slate-300 rounded px-2 py-1 text-xs"
                                        >
                                          {SET_ASIDE_CATEGORIES.map((c) => (
                                            <option key={c} value={c}>
                                              {c}
                                            </option>
                                          ))}
                                        </select>
                                        <button
                                          type="button"
                                          onClick={() => submitAside(t.id)}
                                          disabled={busy || !(Number(asideAmount) > 0)}
                                          className="text-xs text-white bg-violet-700 rounded px-2.5 py-1 disabled:opacity-50"
                                        >
                                          ตัดยอดออก
                                        </button>
                                        {asideError && <p className="w-full text-xs text-red-600">{asideError}</p>}
                                        <p className="w-full text-xs text-slate-400">
                                          ส่วนที่ตัดออกไม่นับเป็นค่าหักของรอบ {selected?.label ?? "นี้"} และลงเป็นรายการ
                                          ของ {m.name} ที่แถบธุรกรรม — ส่วนที่เหลือยังนับเหมือนเดิม · ตัดผิดกด "รวมกลับ" ได้
                                        </p>
                                      </div>
                                    )}
                                    {carryingTransfer === t.id && selectedId && (
                                      <CarryToDebtForm
                                        roundId={selectedId}
                                        transfer={t}
                                        defaultMemberNumber={m.memberNumber}
                                        openDebts={openDebts.filter((d) => d.sourceRoundId !== selectedId)}
                                        onDone={afterCarry}
                                      />
                                    )}
                                    {splittingTransfer === t.id && (
                                      <div className="w-full flex flex-wrap items-center gap-2 pt-1 pl-1 border-t border-dashed border-slate-200 mt-1">
                                        <span className="text-xs text-slate-500">ย้าย</span>
                                        <input
                                          type="number"
                                          inputMode="decimal"
                                          step="0.01"
                                          value={splitAmountInput}
                                          onChange={(e) => setSplitAmountInput(e.target.value)}
                                          className="border border-slate-300 rounded px-2 py-1 text-xs w-24"
                                        />
                                        <span className="text-xs text-slate-500">บาท ให้เลขสมาชิก</span>
                                        <input
                                          type="text"
                                          value={splitMemberNumber}
                                          onChange={(e) => setSplitMemberNumber(e.target.value)}
                                          placeholder="เลขสมาชิก"
                                          className="border border-slate-300 rounded px-2 py-1 text-xs w-28"
                                          autoFocus
                                        />
                                        <button
                                          type="button"
                                          onClick={() => submitSplit(t.id)}
                                          disabled={busy || !splitMemberNumber.trim()}
                                          className="text-xs text-white bg-slate-900 rounded px-2.5 py-1 disabled:opacity-50"
                                        >
                                          ย้ายยอด
                                        </button>
                                        {splitError && (
                                          <p className="w-full text-xs text-red-600">{splitError}</p>
                                        )}
                                        <p className="w-full text-xs text-slate-400">
                                          เลขสมาชิกปลายทางต้องอยู่ในรอบ {selected?.label ?? "นี้"} — ส่วนที่ไม่ได้ย้าย
                                          (ถ้ามี) ยังนับเป็นของ {m.name} เหมือนเดิม
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                ))}
                                {/* Recorded on the daily page but not taken
                                    into the round: the member was already
                                    settled when it was filed. Read-only. */}
                                {recordedOutsideOf(m.memberNumber).map((r) => (
                                  <div
                                    key={r.id}
                                    className="flex flex-wrap items-center gap-3 text-sm py-1 border-t border-slate-200 text-slate-500"
                                    title="บันทึกเป็นชำระเก็บไม่ได้รายเดือนที่หน้าเงินเข้าประจำวันแล้ว แต่ตอนบันทึกสมาชิกคนนี้มีสถานะครบในรอบนี้อยู่แล้ว จึงไม่นับซ้ำในรอบ — ดู/แก้รายการได้ที่หน้าเงินเข้าประจำวันหรือแถบธุรกรรม"
                                  >
                                    <span className="num whitespace-nowrap font-medium">
                                      {formatAmount(r.amount)}
                                    </span>
                                    <span className="num whitespace-nowrap">
                                      {formatStatementDateTime(r.date)}
                                    </span>
                                    <span className="text-xs text-slate-500">
                                      📒 บันทึกจากหน้าเงินเข้าประจำวัน · ไม่นับในรอบนี้
                                      {m.deductionResult === "collected"
                                        ? " (หักเงินเดือนได้ครบแล้ว)"
                                        : " (ยอดครบแล้วตอนบันทึก)"}
                                    </span>
                                  </div>
                                ))}
                                {transfersOf(m.memberNumber).length === 0 &&
                                  recordedOutsideOf(m.memberNumber).length === 0 && (
                                    <p className="text-xs text-slate-400 py-1 border-t border-slate-200">
                                      ไม่มีรายการโอนของสมาชิกคนนี้ในรอบนี้
                                    </p>
                                  )}
                                <div className="pt-2 mt-1 border-t border-slate-200">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      cashMember === m.memberNumber
                                        ? closeCash()
                                        : openCash(m.memberNumber)
                                    }
                                    disabled={busy || frozen}
                                    className="text-xs text-slate-600 border border-slate-300 rounded px-2 py-1 hover:bg-slate-50 disabled:opacity-50"
                                    title="สมาชิกจ่ายเป็นเงินสดที่สำนักงาน — ไม่มีบรรทัดในสเตทเมนต์ธนาคารให้จับคู่ ต้องบันทึกตรงนี้"
                                  >
                                    {cashMember === m.memberNumber ? "ยกเลิกบันทึกเงินสด" : "บันทึกว่าจ่ายเงินสดแล้ว"}
                                  </button>
                                  {cashMember === m.memberNumber && (
                                    <div className="w-full flex flex-wrap items-center gap-2 pt-2">
                                      <span className="text-xs text-slate-500">ยอด</span>
                                      <input
                                        type="number"
                                        inputMode="decimal"
                                        step="0.01"
                                        value={cashAmount}
                                        onChange={(e) => setCashAmount(e.target.value)}
                                        className="border border-slate-300 rounded px-2 py-1 text-xs w-24"
                                        autoFocus
                                      />
                                      <span className="text-xs text-slate-500">บาท วันที่จ่าย</span>
                                      <input
                                        type="date"
                                        value={cashDate}
                                        onChange={(e) => setCashDate(e.target.value)}
                                        className="border border-slate-300 rounded px-2 py-1 text-xs"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => submitCash(m.memberNumber)}
                                        disabled={busy || !cashAmount.trim() || !cashDate}
                                        className="text-xs text-white bg-slate-900 rounded px-2.5 py-1 disabled:opacity-50"
                                      >
                                        บันทึกเงินสด
                                      </button>
                                      {cashError && (
                                        <p className="w-full text-xs text-red-600">{cashError}</p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {unmatched.length > 0 && (
            <div className="px-4 py-3 border-t border-slate-100">
              <button
                onClick={() => toggle("unmatched", unmatched.length)}
                aria-expanded={unmatchedOpen}
                className="text-sm font-semibold text-amber-800 text-left hover:underline"
              >
                {unmatchedOpen ? "▾" : "▸"} โอนเข้ามาแต่ไม่พบเจ้าของ (
                <span className="num">{unmatched.length}</span> รายการ)
              </button>
              {/* The same two clicks a row, for rows the system already has
                  the answer to. Offered here rather than only on each row
                  because on a list of hundreds the repetition is the work. */}
              {recordedBindings.length > 0 && (
                <button
                  onClick={() => setConfirmRecorded(true)}
                  disabled={busy || frozen}
                  className="ml-3 text-xs px-2.5 py-1 border border-sky-300 bg-sky-50 text-sky-800 rounded disabled:opacity-50"
                  title="เงินเข้าประจำวันบันทึกไว้แล้วว่าบัญชีเหล่านี้เป็นของใคร — ผูกให้ทีเดียว โดยขอดูรายการก่อน"
                  aria-label="ใช้เลขที่เงินเข้าประจำวันบันทึกไว้ทั้งหมด"
                >
                  ใช้เลขที่เงินเข้าประจำวันบันทึกไว้ทั้งหมด (
                  <span className="num">{recordedBindings.length}</span> บัญชี)
                </button>
              )}
              {/* Only while the rows are showing: a folded section is a
                  heading and a count, and a sort control over nothing is
                  clutter in the one place the fold was meant to clear. */}
              {unmatchedOpen && unmatched.length > 1 && (
                <label className="ml-3 text-xs text-slate-500">
                  เรียง{" "}
                  <select
                    value={unmatchedSort}
                    onChange={(e) => setUnmatchedSort(e.target.value as UnmatchedSort)}
                    className="border border-slate-300 rounded px-2 py-1 bg-white text-slate-900"
                  >
                    {UNMATCHED_SORT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="text-xs text-slate-500 mt-1">
                เลขบัญชีที่โอนเข้ามาไม่ตรงกับใครในรายชื่อหักไม่ได้รอบนี้ —
                กด <strong>"ระบุเจ้าของ"</strong> แล้วใส่เลขสมาชิก ระบบจะจับคู่ให้ทันที
                และ<strong>จำเลขบัญชีนี้ไว้ใช้รอบต่อๆ ไป</strong>ด้วย ไม่ต้องมาระบุซ้ำทุกเดือน
                (หรือจะแก้เลขบัญชีในไฟล์รายชื่อแล้วอัปโหลดใหม่ก็ได้เหมือนเดิม)
              </p>
              {unmatchedOpen && (
                <table className="w-full text-sm mt-2">
                  <thead className="text-slate-500 text-left">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">เลขบัญชี</th>
                      <th className="px-2 py-1.5 font-medium text-right">ยอด</th>
                      <th className="px-2 py-1.5 font-medium">วันเวลาที่โอน</th>
                      <th className="px-2 py-1.5 font-medium">บัญชีที่รับ</th>
                      <th className="px-2 py-1.5 font-medium">เป็นเงินอะไร</th>
                      <th className="px-2 py-1.5 font-medium">เจ้าของ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownUnmatched.map((t) => (
                      <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-2 py-1.5 font-mono text-xs">{t.accountNumber}</td>
                        <td className="px-2 py-1.5 num text-right whitespace-nowrap font-medium">
                          {formatAmount(t.amount)}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">
                          <DateTimeCell iso={t.transferredAt} />
                        </td>
                        <td className="px-2 py-1.5 text-slate-500">{t.branch ?? "—"}</td>
                        <td className="px-2 py-1.5">
                          <select
                            value=""
                            onChange={(e) =>
                              e.target.value && setTransferReason(t.id, e.target.value)
                            }
                            disabled={busy || frozen}
                            className="border border-slate-300 rounded px-2 py-1 text-xs"
                            title="เงินก้อนนี้ไม่ใช่ค่าหักไม่ได้ — เอาออกจากรายการที่ต้องตาม"
                          >
                            <option value="">ยังไม่ระบุ</option>
                            {EXCLUDE_REASONS.map((r) => (
                              <option key={r} value={r}>
                                ไม่เกี่ยวกับรอบนี้ — {r}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {assigningAccount === t.accountNumber ? (
                            <span className="inline-flex flex-wrap items-center gap-2">
                              <input
                                value={assignMemberNumber}
                                onChange={(e) => {
                                  setAssignMemberNumber(e.target.value);
                                  setAssignNote(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") assignAccount(t.accountNumber);
                                  if (e.key === "Escape") setAssigningAccount(null);
                                }}
                                list="statement-member-numbers"
                                placeholder="เลขสมาชิก"
                                autoFocus
                                className="border border-slate-300 rounded px-2 py-1 text-sm w-44"
                              />
                              <button
                                onClick={() => assignAccount(t.accountNumber)}
                                disabled={busy || !assignMemberNumber.trim()}
                                className="text-slate-900 hover:underline disabled:opacity-40"
                              >
                                บันทึก
                              </button>
                              <button
                                onClick={() => {
                                  setAssigningAccount(null);
                                  setAssignNote(null);
                                }}
                                className="text-slate-500 hover:underline"
                              >
                                ยกเลิก
                              </button>

                            </span>
                          ) : (
                            <button
                              onClick={() => {
                                setAssigningAccount(t.accountNumber);
                                setAssignMemberNumber("");
                                setAssignNote(null);
                              }}
                              className="text-slate-900 hover:underline"
                            >
                              ระบุเจ้าของ
                            </button>
                          )}
                          {/* The daily page has already been told whose this
                              is — staff rang round and recorded the payment
                              there. The round cannot hear about a recording, so
                              it says so here and offers the one click that
                              makes it official. */}
                          {t.recordedAs && assigningAccount !== t.accountNumber && (
                            <span className="block max-w-md text-xs text-sky-800 mt-1 whitespace-normal">
                              เงินเข้าประจำวันบันทึกไว้แล้วว่าเป็นของ{" "}
                              <strong className="num">{t.recordedAs.memberNumber}</strong>{" "}
                              {t.recordedAs.memberName ?? ""}
                              {t.recordedAs.category ? ` · ${t.recordedAs.category}` : ""}{" "}
                              <button
                                onClick={() => {
                                  setAssigningAccount(t.accountNumber);
                                  setAssignMemberNumber(t.recordedAs!.memberNumber);
                                  setAssignNote(null);
                                }}
                                className="text-sky-800 underline"
                                title="ใส่เลขสมาชิกนี้ให้ แล้วกดบันทึกเพื่อผูกเลขบัญชี — รอบจะจับคู่ให้ทันทีถ้าสมาชิกอยู่ในรายชื่อรอบนี้"
                              >
                                ใช้เลขนี้
                              </button>
                            </span>
                          )}
                          {/* Bound, but to a number that is in no list at all.
                              The row stays here rather than reading as
                              settled: a member nobody has heard of is a typo
                              until somebody says otherwise, and the money is
                              still nobody's. */}
                          {t.boundTo && !t.boundTo.inRoster && assigningAccount !== t.accountNumber && (
                            <span className="block max-w-md text-xs text-red-700 mt-1 whitespace-normal">
                              ⚠️ ผูกไว้กับเลขสมาชิก{" "}
                              <strong className="num">{t.boundTo.memberNumber}</strong>{" "}
                              ซึ่ง<strong>ไม่พบในทะเบียนสมาชิก</strong>และไม่ได้อยู่ในรอบนี้ —
                              ตรวจสอบว่าพิมพ์ถูกไหม แล้วกด "ระบุเจ้าของ" ใหม่เพื่อแก้
                            </span>
                          )}
                          {/* The answer, where the click was. The panel's own
                              error and notice sit at the top of the tab, far
                              above this table. */}
                          {assignNote?.account === t.accountNumber && (
                            <span
                              className={`block max-w-md text-xs mt-1 whitespace-normal ${
                                assignNote.bad ? "text-red-700" : "text-amber-800"
                              }`}
                            >
                              {assignNote.bad ? "⚠️ " : "ℹ️ "}
                              {assignNote.text}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

            </div>
          )}

          {/* Native autocomplete over this round's members, so staff can type
              either the number or the name to find it. Panel-level because
              both lists below offer the same box. */}
          <datalist id="statement-member-numbers">
            {members.map((m) => (
              <option key={m.id} value={m.memberNumber}>
                {m.name}
                {m.unitName ? ` · ${m.unitName}` : ""}
              </option>
            ))}
          </datalist>

          {/* The rows staff have finished with. They left the list above the
              moment the owner was written down, which is what makes working
              through that list feel like getting somewhere — see
              lib/boundTransfers.ts. */}
          {outsideRound.length > 0 && (
            <div className="px-4 py-3 border-t border-slate-100">
              <button
                onClick={() => toggle("outsideRound", outsideRound.length)}
                aria-expanded={outsideRoundOpen}
                className="text-sm font-semibold text-slate-700 text-left hover:underline"
              >
                {outsideRoundOpen ? "▾" : "▸"} รู้เจ้าของแล้ว แต่ไม่ได้อยู่ในรอบนี้ (
                <span className="num">{outsideRound.length}</span> รายการ ·{" "}
                <span className="num">{formatAmount(outsideRoundTotal)}</span>)
              </button>
              <p className="text-xs text-slate-500 mt-1">
                ผูกเลขบัญชีกับสมาชิกไว้แล้ว แต่สมาชิกคนนั้น<strong>ไม่ได้อยู่ในรายชื่อหักไม่ได้รอบนี้</strong> —
                รอบนี้จึงไม่นับเป็นการชำระ เพราะเขาไม่ได้ค้างอะไรในรอบนี้ ไม่มีอะไรให้ตัด
                (เงินเข้ามาจริง และหน้าเงินเข้าประจำวันกับรอบต่อๆ ไปรู้จักเลขบัญชีนี้แล้ว) ·
                ถ้าผูกผิดคน กด <strong>"แก้เจ้าของ"</strong> เพื่อเปลี่ยนได้
              </p>
              {outsideRoundOpen && (
                <table className="w-full text-sm mt-2">
                  <thead className="text-slate-500 text-left">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">เลขบัญชี</th>
                      <th className="px-2 py-1.5 font-medium text-right">ยอด</th>
                      <th className="px-2 py-1.5 font-medium">วันเวลาที่โอน</th>
                      <th className="px-2 py-1.5 font-medium">บัญชีที่รับ</th>
                      <th className="px-2 py-1.5 font-medium">เป็นของ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outsideRound.map((t) => (
                      <Fragment key={t.id}>
                      <tr className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-2 py-1.5 font-mono text-xs">{t.accountNumber}</td>
                        <td className="px-2 py-1.5 num text-right whitespace-nowrap font-medium">
                          {formatAmount(t.amount)}
                          {t.carriedAmount > 0 && (
                            <span className="block text-xs font-normal text-amber-700">
                              ↪ ชำระข้ามเดือน {formatAmount(t.carriedAmount)}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">
                          <DateTimeCell iso={t.transferredAt} />
                        </td>
                        <td className="px-2 py-1.5 text-slate-500">{t.branch ?? "—"}</td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {assigningAccount === t.accountNumber ? (
                            <span className="inline-flex flex-wrap items-center gap-2">
                              <input
                                value={assignMemberNumber}
                                onChange={(e) => setAssignMemberNumber(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") assignAccount(t.accountNumber);
                                  if (e.key === "Escape") setAssigningAccount(null);
                                }}
                                list="statement-member-numbers"
                                placeholder="เลขสมาชิก"
                                autoFocus
                                className="border border-slate-300 rounded px-2 py-1 text-sm w-44"
                              />
                              <button
                                onClick={() => assignAccount(t.accountNumber)}
                                disabled={busy || !assignMemberNumber.trim()}
                                className="text-slate-900 hover:underline disabled:opacity-40"
                              >
                                บันทึก
                              </button>
                              <button
                                onClick={() => setAssigningAccount(null)}
                                className="text-slate-500 hover:underline"
                              >
                                ยกเลิก
                              </button>
                            </span>
                          ) : (
                            <>
                              <strong className="num">{t.boundTo.memberNumber}</strong>{" "}
                              {t.boundTo.memberName ?? ""}{" "}
                              <button
                                onClick={() => {
                                  setAssigningAccount(t.accountNumber);
                                  setAssignMemberNumber(t.boundTo.memberNumber);
                                }}
                                className="text-slate-500 hover:underline text-xs"
                              >
                                แก้เจ้าของ
                              </button>
                              {/* Not on this round's list, but may still owe a
                                  month that has been closed — the commonest
                                  way a carried debt gets paid. */}
                              {owedEarlier(t.boundTo.memberNumber) > 0 && (
                                <span className="block text-xs text-amber-700">
                                  ⚠️ ค้างข้ามเดือน {formatAmount(owedEarlier(t.boundTo.memberNumber))}
                                </span>
                              )}
                              {canCarry(t) && (
                                <button
                                  onClick={() =>
                                    setCarryingTransfer(carryingTransfer === t.id ? null : t.id)
                                  }
                                  disabled={busy}
                                  className="ml-2 text-xs text-amber-800 border border-amber-300 rounded px-2 py-0.5 hover:bg-amber-50 disabled:opacity-50"
                                >
                                  {carryingTransfer === t.id ? "ยกเลิก" : "ชำระข้ามเดือน"}
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                      {carryingTransfer === t.id && selectedId && (
                        <tr className="bg-amber-50/40">
                          <td colSpan={5} className="px-2 pb-2">
                            <CarryToDebtForm
                              roundId={selectedId}
                              transfer={t}
                              defaultMemberNumber={t.boundTo.memberNumber}
                              openDebts={openDebts.filter((d) => d.sourceRoundId !== selectedId)}
                              onDone={afterCarry}
                            />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {excludedTransfers.length > 0 && (
            <div className="px-4 py-3 border-t border-slate-100">
              <button
                onClick={() => toggle("excluded", excludedTransfers.length)}
                aria-expanded={excludedOpen}
                className="text-sm font-semibold text-slate-700 text-left hover:underline"
              >
                {excludedOpen ? "▾" : "▸"} เงินเข้าที่ไม่เกี่ยวกับรอบนี้ (
                <span className="num">{excludedTransfers.length}</span> รายการ ·{" "}
                <span className="num">{formatAmount(excludedTotal)}</span>)
              </button>
              <p className="text-xs text-slate-500 mt-1">
                เงินที่โอนเข้ามาจริงแต่เป็นเรื่องอื่น (ซื้อหุ้น ชำระหนี้ ฝากเงิน ฯลฯ)
                ไม่ถูกนับเป็นการจ่ายค่าหักไม่ได้ — เก็บไว้ให้เห็นเพราะเป็นเงินที่เข้ามาจริง
                ถ้าระบุผิดเลือก "นับเป็นจ่ายค่าหักไม่ได้" เพื่อเอากลับเข้ารอบได้
              </p>
              {excludedOpen && (
                <table className="w-full text-sm mt-2">
                  <thead className="text-slate-500 text-left">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">เลขบัญชี</th>
                      <th className="px-2 py-1.5 font-medium text-right">ยอด</th>
                      <th className="px-2 py-1.5 font-medium">วันเวลาที่โอน</th>
                      <th className="px-2 py-1.5 font-medium">เจ้าของ</th>
                      <th className="px-2 py-1.5 font-medium">เป็นเงินอะไร</th>
                    </tr>
                  </thead>
                  <tbody>
                    {excludedTransfers.map((t) => (
                      <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-2 py-1.5 font-mono text-xs">{t.accountNumber}</td>
                        <td className="px-2 py-1.5 num text-right whitespace-nowrap font-medium">
                          {formatAmount(t.amount)}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">
                          <DateTimeCell iso={t.transferredAt} />
                        </td>
                        <td className="px-2 py-1.5 num text-slate-500">{t.memberNumber ?? "—"}</td>
                        <td className="px-2 py-1.5">
                          <select
                            value={t.excludedReason ?? ""}
                            onChange={(e) => setTransferReason(t.id, e.target.value || null)}
                            disabled={busy || frozen}
                            className="border border-amber-300 bg-amber-50 rounded px-2 py-1 text-xs"
                          >
                            <option value="">นับเป็นจ่ายค่าหักไม่ได้</option>
                            {EXCLUDE_REASONS.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      <input
        ref={membersInputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={uploadMembers}
        className="hidden"
      />
      <input
        ref={deductionListInputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={uploadDeductionList}
        className="hidden"
      />
      <input
        ref={statementInputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={uploadStatement}
        className="hidden"
      />

      <ConfirmDialog
        open={pendingClose}
        title={`ปิดรอบ ${selected?.label ?? ""}?`}
        tone="neutral"
        confirmLabel="ปิดรอบ"
        onConfirm={closeRound}
        onCancel={() => setPendingClose(false)}
      >
        {(() => {
          // The same rule the close route applies, so the count asked about
          // is the count that gets carried.
          const carrying = members.filter((m) => outstandingAtClose(m) > 0);
          const carryingAmount = carrying.reduce((sum, m) => sum + outstandingAtClose(m), 0);
          const awaiting = members.filter((m) => m.deductionResult === "awaiting").length;
          return (
            <div className="space-y-2 text-sm text-slate-700">
              <p>
                ยอดที่ยังค้างจะถูกยกไปตั้งเป็นหนี้ที่แถบ <strong>ชำระข้ามเดือน</strong>:{" "}
                <strong className="num">{carrying.length}</strong> คน รวม{" "}
                <strong className="num">{formatAmount(carryingAmount)}</strong>
              </p>
              <p>หลังปิดแล้วรอบนี้จะแก้ไม่ได้ (อัปโหลดไฟล์เพิ่ม บันทึกเงินสด แบ่งยอด ฯลฯ ไม่ได้)</p>
              {awaiting > 0 && (
                <p className="text-amber-800">
                  ⚠️ ยังมี <strong className="num">{awaiting}</strong> คนที่หน่วยยังไม่ส่งผลการหัก —
                  คนกลุ่มนี้จะไม่ถูกยกยอดไป เพราะยังไม่รู้ว่าค้างหรือไม่
                </p>
              )}
            </div>
          );
        })()}
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="ลบรอบเทียบ Statement นี้?"
        description={
          pendingDelete
            ? `${pendingDelete.label} — จะลบรายชื่อหักไม่ได้และรายการโอนที่อ่านมาจาก Statement ของรอบนี้ทั้งหมด ` +
              `(ไฟล์ต้นฉบับในเครื่องไม่ถูกแตะต้อง อัปโหลดใหม่ได้เสมอ)`
            : undefined
        }
        confirmLabel="ลบรอบ"
        onConfirm={confirmDeleteRound}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={pendingClear !== null}
        title={
          pendingClear?.file
            ? `ลบไฟล์ ${pendingClear.file.name ?? "(ไม่ทราบชื่อไฟล์)"} ออกจากรอบนี้?`
            : `ล้างรายการโอนของบัญชี ${pendingClear?.account ?? ""}?`
        }
        description={
          pendingClear?.file
            ? `จะลบรายการโอน ${pendingClear.file.transfers} รายการที่อ่านมาจากไฟล์นี้ ` +
              `(บัญชี ${pendingClear.account} ${pendingClear.branch}) ในรอบนี้ — ไฟล์อื่น รายชื่อหักไม่ได้ ` +
              `และบรรทัดในหน้าเงินเข้าประจำวันไม่ถูกแตะต้อง ยอดชำระของสมาชิกจะคำนวณใหม่ให้ ` +
              `อัปโหลดไฟล์เดิมกลับเข้าไปได้เสมอ`
            : pendingClear
              ? `จะลบรายการโอนทุกรายการที่อ่านมาจาก Statement ของบัญชี ${pendingClear.account} ` +
                `${pendingClear.branch} ในรอบนี้ (ทุกไฟล์) — อีกบัญชีและรายชื่อหักไม่ได้ไม่ถูกแตะต้อง ` +
                `ใช้เมื่ออัปโหลดผิดบัญชีหรืออยากเริ่มอ่านใหม่ อัปโหลดไฟล์เดิมกลับเข้าไปได้เสมอ`
              : undefined
        }
        confirmLabel={pendingClear?.file ? "ลบไฟล์นี้" : "ล้างรายการ"}
        onConfirm={confirmClearAccount}
        onCancel={() => setPendingClear(null)}
      />

      <SheetMappingDialog
        open={pendingSheet !== null}
        fileName={pendingSheet?.file.name ?? ""}
        preview={pendingSheet?.preview ?? null}
        mapping={pendingSheet?.mapping ?? {}}
        onChange={changeMapping}
        onPickSheet={pickSheet}
        onConfirm={confirmSheet}
        onCancel={() => setPendingSheet(null)}
        busy={busy}
        confirmLabel={
          pendingSheet?.kind === "list" ? "นำเข้ารายการหัก" : "บันทึกผลการหัก"
        }
      />

      {/* The list, before it is written. "ผูก 37 บัญชี" is not a question
          anybody can answer without seeing the 37 — and one of them naming
          the wrong person is exactly what this is for catching. */}
      <ConfirmDialog
        open={confirmRecorded}
        tone="neutral"
        title={`ผูกเลขบัญชีตามที่เงินเข้าประจำวันบันทึกไว้ ${recordedBindings.length} บัญชี?`}
        description={
          "เจ้าหน้าที่บันทึกรายการเหล่านี้ไว้ที่หน้าเงินเข้าประจำวันแล้ว — กดยืนยันเพื่อผูกเลขบัญชีให้ทั้งหมดทีเดียว " +
          "(เท่ากับกด “ใช้เลขนี้” ทีละแถว) · ถ้ามีแถวไหนเป็นคนโอนแทน ไม่ใช่เจ้าของบัญชี ให้ยกเลิกแล้วทำทีละแถวแทน"
        }
        confirmLabel="ผูกทั้งหมด"
        cancelLabel="ยกเลิก"
        onConfirm={applyRecordedOwners}
        onCancel={() => setConfirmRecorded(false)}
      >
        <div className="max-h-64 overflow-y-auto border border-slate-200 rounded divide-y divide-slate-100">
          {recordedBindings.map((b) => (
            <div key={b.accountNumber} className="flex items-baseline gap-2 px-3 py-1.5 text-sm">
              <span className="font-mono text-xs text-slate-500">{b.accountNumber}</span>
              <span className="text-slate-400">→</span>
              <strong className="num">{b.memberNumber}</strong>
              <span className="truncate">{b.memberName ?? ""}</span>
              {b.category && (
                <span className="text-xs text-slate-400 ml-auto whitespace-nowrap">
                  {b.category}
                </span>
              )}
            </div>
          ))}
        </div>
      </ConfirmDialog>

      {/* Three answers, because the question has three. Units send their
          หักไม่ได้ one at a time, and the only two offered before were
          "this file is the whole round" and "do nothing" — neither of which
          is "add this unit's people to what is already here". */}
      <ConfirmDialog
        open={pendingShrink !== null}
        title="ไฟล์นี้ไม่มีคนส่วนใหญ่ที่อยู่ในรอบ — จะเอาแบบไหน?"
        description={pendingShrink?.description}
        alternateLabel="เพิ่มเข้าไปในรอบ (ไม่ลบใคร)"
        onAlternate={() => {
          const pending = pendingShrink;
          setPendingShrink(null);
          if (pending) {
            sendMembers(
              pending.file,
              pending.roundId,
              false,
              pending.mapping,
              pending.firstDataRow,
              pending.sheet,
              true
            );
          }
        }}
        confirmLabel="แทนที่รายชื่อทั้งรอบ"
        cancelLabel="ยกเลิก"
        onConfirm={() => {
          const pending = pendingShrink;
          setPendingShrink(null);
          if (pending) {
            sendMembers(
              pending.file,
              pending.roundId,
              true,
              pending.mapping,
              pending.firstDataRow,
              pending.sheet
            );
          }
        }}
        onCancel={() => setPendingShrink(null)}
      />
    </div>
  );
}
