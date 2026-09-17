"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  formatAmount,
  formatStatementDate,
  formatStatementDateTime,
  formatStatementTime,
} from "@/lib/format";
import {
  StatementFileSummary,
  StatementMemberRow,
  StatementRoundSummary,
  StatementTransferRow,
  StatementOutsideRoundRow,
  StatementUnmatchedRow,
} from "@/lib/types";

import ConfirmDialog from "@/components/ConfirmDialog";
import PanelHelp from "@/components/PanelHelp";
import { describeDeductionPeriod } from "@/lib/deductionPeriod";
import { downloadStatementMembersCsv } from "@/lib/csv";
import { EXCLUDE_REASONS } from "@/lib/statementSlipHints";
import { describeDoubleCount } from "@/lib/roundDoubleCount";
import { sectionOpen } from "@/lib/sections";
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
  sortStatementMembers,
  summarizeStatementMembers,
  unitNamesOf,
} from "@/lib/statementFilters";

const SEARCH_DEBOUNCE_MS = 300;

const SORT_OPTIONS: { value: StatementSort; label: string }[] = [
  { value: "default", label: "ยังค้างขึ้นก่อน (ค่าเริ่มต้น)" },
  { value: "outstanding", label: "ยอดค้างมาก → น้อย" },
  { value: "hCode", label: "หน่วยคุม" },
  { value: "unitName", label: "สังกัด" },
  { value: "paidAt", label: "วันที่โอน (ล่าสุดก่อน)" },
  { value: "name", label: "ชื่อ ก-ฮ" },
  { value: "memberNumber", label: "เลขสมาชิก" },
];

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
  const [statements, setStatements] = useState<StatementFileSummary[]>([]);
  const [transfers, setTransfers] = useState<StatementTransferRow[]>([]);
  const [excludedTotal, setExcludedTotal] = useState(0);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [pendingClear, setPendingClear] = useState<{ account: string; branch: string } | null>(
    null
  );
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
  } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [hCodeFilter, setHCodeFilter] = useState("");
  const [assigningAccount, setAssigningAccount] = useState<string | null>(null);
  const [assignMemberNumber, setAssignMemberNumber] = useState("");
  // What happened to the last attempt on this account, shown at its own row.
  // Both the panel's error and its notice are painted at the top, thousands of
  // pixels above a table that runs to hundreds of rows — from down here,
  // failure and a success with a caveat both look like nothing happening.
  const [assignNote, setAssignNote] = useState<
    { account: string; text: string; bad: boolean } | null
  >(null);
  const [sort, setSort] = useState<StatementSort>("default");
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

  useEffect(() => {
    fetchRounds().then((data) => {
      if (data && data.length > 0) setSelectedId((prev) => prev ?? data[0].id);
    });
  }, [fetchRounds]);

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
    setUnitFilter("");
    setHCodeFilter("");
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
  const sendMembers = async (file: File, roundId: string, confirm: boolean) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (confirm) form.append("confirm", "yes");
      const res = await fetch(`/api/statement-rounds/${roundId}/members`, {
        method: "POST",
        body: form,
      });
      const body = await res.json();
      if (res.status === 409 && body.needsConfirm) {
        // Not an error — the upload is legitimate but destructive, so it
        // waits for a person to look at the numbers.
        setPendingShrink({ file, roundId, description: body.error });
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
          `บันทึกผลการหักแล้ว: อัปเดต ${body.updated} คน` +
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
          (body.filledFromDirectory > 0
            ? ` — เติมเลขบัญชีจากทะเบียนให้ ${body.filledFromDirectory} คน`
            : "") +
          (body.missingAccount > 0
            ? ` — มี ${body.missingAccount} คนไม่มีเลขบัญชีในไฟล์ จับคู่กับ Statement ไม่ได้`
            : "")
      );
      await Promise.all([fetchRound(roundId), fetchRounds()]);
    } finally {
      setBusy(false);
    }
  };

  const uploadMembers = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selectedId) return;
    await sendMembers(file, selectedId, false);
  };

  // The รายการหัก that starts the round. Merges, so the whole cooperative can
  // go in at once or one เขต at a time, and re-uploading a corrected file
  // never takes the rest of the round away.
  const uploadDeductionList = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selectedId) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/statement-rounds/${selectedId}/deduction-list`, {
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
            : "")
      );
      await Promise.all([fetchRound(selectedId), fetchRounds()]);
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
    const { account: acct, branch } = pendingClear;
    setPendingClear(null);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/statement-rounds/${selectedId}/statement?account=${encodeURIComponent(acct)}`,
        { method: "DELETE" }
      );
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "ล้างรายการไม่สำเร็จ");
        return;
      }
      setNotice(`ล้างรายการโอนของบัญชี ${acct} ${branch} แล้ว ${body.removed} รายการ`);
      await Promise.all([fetchRound(selectedId), fetchRounds()]);
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteRound = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    await fetch(`/api/statement-rounds/${id}`, { method: "DELETE" });
    const data = await fetchRounds();
    setSelectedId(data && data.length > 0 ? data[0].id : null);
  };

  const selected = rounds.find((r) => r.id === selectedId) ?? null;
  const hCodes = hCodesOf(members);
  // The สังกัด list narrows to whatever หน่วยคุม is selected, so the two
  // dropdowns can't be combined into a pairing that matches nobody.
  const units = unitNamesOf(
    hCodeFilter ? members.filter((m) => m.hCode === hCodeFilter) : members
  );
  const shown = sortStatementMembers(
    filterStatementMembers(members, {
      search,
      unitName: unitFilter,
      hCode: hCodeFilter,
      status: statusFilter,
    }),
    sort
  );
  const shownTotals = summarizeStatementMembers(shown);
  const filtered =
    statusFilter !== "all" || unitFilter !== "" || hCodeFilter !== "" || search !== "";
  const missingAccountCount = members.filter((m) => !m.accountNumber).length;

  const transfersOf = (memberNumber: string) =>
    transfers.filter((t) => t.memberNumber === memberNumber);
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
    setUnitFilter("");
    setHCodeFilter("");
    setSearchInput("");
    setSearch("");
  };

  // Picking a หน่วยคุม that the current สังกัด doesn't belong to would leave a
  // stale unit selected and an empty table with no obvious cause.
  const changeHCode = (next: string) => {
    setHCodeFilter(next);
    if (unitFilter && next && !members.some((m) => m.hCode === next && m.unitName === unitFilter)) {
      setUnitFilter("");
    }
  };

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
        <button
          onClick={() => setShowNew((v) => !v)}
          className="text-sm px-3 py-1.5 border border-slate-300 rounded whitespace-nowrap"
        >
          {showNew ? "ยกเลิก" : "+ สร้างรอบใหม่"}
        </button>
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
                {r.label}{" "}
                <span className={r.id === selectedId ? "text-slate-300" : "text-slate-400"}>
                  ({r.paidMembers + r.overpaidMembers}/{r.totalMembers})
                </span>
              </button>
            ))}
          </div>

          {selected && (
            <>
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
                  onClick={() => setPendingDelete(selected)}
                  className="ml-auto text-red-600 hover:underline"
                >
                  ลบรอบนี้
                </button>
              </div>

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
                  <span className="text-slate-500">Statement ที่โหลดไว้แล้ว:</span>{" "}
                  {statements.map((s, i) => (
                    <span key={`${s.account}-${s.sourceFile ?? i}`}>
                      {i > 0 && <span className="text-slate-300"> · </span>}
                      <span className="font-mono">{s.account}</span> {s.sourceFile ?? "(ไม่ทราบชื่อไฟล์)"}{" "}
                      <span className="text-slate-400">
                        ({s.transfers} รายการ {formatAmount(s.amount)})
                      </span>
                    </span>
                  ))}
                  <span className="text-slate-400">
                    {" "}
                    — อัปโหลดเพิ่มได้เรื่อยๆ รายการที่มีอยู่แล้วจะไม่ถูกนับซ้ำ
                  </span>
                  <span className="ml-2">
                    {ACCOUNTS.filter((a) => statements.some((s) => s.account === a.value)).map(
                      (a) => (
                        <button
                          key={a.value}
                          onClick={() =>
                            setPendingClear({
                              account: a.value,
                              branch: STATEMENT_BRANCH[a.value] ?? "",
                            })
                          }
                          className="text-red-600 hover:underline ml-2"
                        >
                          ล้าง {a.value}
                        </button>
                      )
                    )}
                  </span>
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
                {missingAccountCount > 0 && (
                  <FilterChip
                    active={statusFilter === "no_account"}
                    onClick={() =>
                      setStatusFilter(statusFilter === "no_account" ? "all" : "no_account")
                    }
                    label="⛔ ไม่มีเลขบัญชี"
                    count={missingAccountCount}
                    countClass="text-amber-700"
                    title="ไม่มีเลขบัญชีในไฟล์รายชื่อ จับคู่กับ Statement ไม่ได้เลย ต้องหาเลขบัญชีมาเติมก่อน"
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
                {hCodes.length > 0 && (
                  <select
                    value={hCodeFilter}
                    onChange={(e) => changeHCode(e.target.value)}
                    className="border border-slate-300 rounded-md px-2 py-1.5 bg-white"
                    title="รหัสหน่วยคุม (H-code) จากคอลัมน์ J ของไฟล์รายชื่อหักไม่ได้"
                  >
                    <option value="">ทุกหน่วยคุม ({hCodes.length})</option>
                    {hCodes.map((h) => (
                      <option key={h} value={h}>
                        หน่วยคุม {h}
                      </option>
                    ))}
                  </select>
                )}
                <select
                  value={unitFilter}
                  onChange={(e) => setUnitFilter(e.target.value)}
                  className="border border-slate-300 rounded-md px-2 py-1.5 bg-white max-w-[16rem]"
                >
                  <option value="">ทุกสังกัด ({units.length})</option>
                  {units.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-slate-500">
                  เรียง
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as StatementSort)}
                    className="border border-slate-300 rounded-md px-2 py-1.5 bg-white text-slate-900"
                  >
                    {SORT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                {filtered && (
                  <button onClick={clearFilters} className="text-slate-500 hover:underline">
                    ล้างตัวกรอง
                  </button>
                )}
                <button
                  onClick={() => downloadStatementMembersCsv(shown, selected.label)}
                  disabled={shown.length === 0}
                  className="ml-auto px-3 py-1.5 border border-slate-300 rounded-md bg-white hover:bg-slate-50 disabled:opacity-40"
                >
                  ส่งออก CSV ({shown.length})
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
                        <th className="px-4 py-2.5 font-semibold">หน่วยคุม</th>
                        <th className="px-4 py-2.5 font-semibold min-w-[12rem]">สังกัด</th>
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
                        const diff = Math.round((m.amountPaid - m.amountDue) * 100) / 100;
                        return (
                          <Fragment key={m.id}>
                          <tr className="border-t border-slate-100 hover:bg-slate-50/75">
                            <td className="px-4 py-2.5 num whitespace-nowrap">{m.memberNumber}</td>
                            <td className="px-4 py-2.5">
                              {m.name}
                              {m.note && (
                                <span className="text-xs text-slate-400"> · {m.note}</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 num whitespace-nowrap text-slate-500">
                              {m.hCode ?? "—"}
                            </td>
                            <td className="px-4 py-2.5">{m.unitName ?? "—"}</td>
                            <td className="px-4 py-2.5 font-mono text-xs">
                              {m.accountNumber ?? (
                                <span className="font-sans text-amber-700">ไม่มีเลขบัญชี</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 num text-right whitespace-nowrap">
                              {m.deductionResult === "uncollected" ? (
                                formatAmount(m.amountDue)
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
                              {m.amountPaid > 0 ? (
                                <button
                                  onClick={() =>
                                    setExpandedMember(
                                      expandedMember === m.memberNumber ? null : m.memberNumber
                                    )
                                  }
                                  className="hover:underline"
                                  title="ดูรายการโอนของคนนี้ / ระบุว่าเงินก้อนไหนไม่ใช่ค่าหักไม่ได้"
                                >
                                  {formatAmount(m.amountPaid)}
                                  {memberHasHint(m.memberNumber) && (
                                    <span className="text-amber-600" title="อาจเป็นเงินที่โอนมาด้วยเหตุผลอื่น">
                                      {" "}⚠️
                                    </span>
                                  )}
                                </button>
                              ) : (
                                "—"
                              )}
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
                              <td colSpan={10} className="px-4 py-2">
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
                                    <span className="ml-auto flex items-center gap-2">
                                      <select
                                        value={t.excludedReason ?? ""}
                                        onChange={(e) =>
                                          setTransferReason(t.id, e.target.value || null)
                                        }
                                        disabled={busy}
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
                                    </span>
                                  </div>
                                ))}
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
                  disabled={busy}
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
                            disabled={busy}
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
                      <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-2 py-1.5 font-mono text-xs">{t.accountNumber}</td>
                        <td className="px-2 py-1.5 num text-right whitespace-nowrap font-medium">
                          {formatAmount(t.amount)}
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
                            </>
                          )}
                        </td>
                      </tr>
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
                            disabled={busy}
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
        title={`ล้างรายการโอนของบัญชี ${pendingClear?.account ?? ""}?`}
        description={
          pendingClear
            ? `จะลบรายการโอนทุกรายการที่อ่านมาจาก Statement ของบัญชี ${pendingClear.account} ` +
              `${pendingClear.branch} ในรอบนี้ (ทุกไฟล์) — อีกบัญชีและรายชื่อหักไม่ได้ไม่ถูกแตะต้อง ` +
              `ใช้เมื่ออัปโหลดผิดบัญชีหรืออยากเริ่มอ่านใหม่ อัปโหลดไฟล์เดิมกลับเข้าไปได้เสมอ`
            : undefined
        }
        confirmLabel="ล้างรายการ"
        onConfirm={confirmClearAccount}
        onCancel={() => setPendingClear(null)}
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

      <ConfirmDialog
        open={pendingShrink !== null}
        title="ไฟล์นี้จะเอารายชื่อส่วนใหญ่ออกจากรอบ — แน่ใจไหม?"
        description={pendingShrink?.description}
        confirmLabel="ใช่ แทนที่รายชื่อทั้งรอบ"
        cancelLabel="ยกเลิก (ไม่แตะรายชื่อเดิม)"
        onConfirm={() => {
          const pending = pendingShrink;
          setPendingShrink(null);
          if (pending) sendMembers(pending.file, pending.roundId, true);
        }}
        onCancel={() => setPendingShrink(null)}
      />
    </div>
  );
}
