"use client";

import { useCallback, useEffect, useState } from "react";
import { Expense, ExpenseSummary } from "@/lib/types";
import { formatAmount } from "@/lib/format";
import { downloadExpensesCsv } from "@/lib/csv";
import ExpenseForm, { ExpenseFormData } from "@/components/ExpenseForm";
import ExpenseFilters, { Filters, toIso } from "@/components/ExpenseFilters";
import ExpenseList from "@/components/ExpenseList";
import LineUsersPanel from "@/components/LineUsersPanel";
import MemberContactPanel from "@/components/MemberContactPanel";
import FeatureFlagsPanel from "@/components/FeatureFlagsPanel";
import ServiceRequestsPanel from "@/components/ServiceRequestsPanel";
import KnowledgePanel from "@/components/KnowledgePanel";
import FormLinksPanel from "@/components/FormLinksPanel";
import DepartmentContactsPanel from "@/components/DepartmentContactsPanel";
import ResponsibleContactsPanel from "@/components/ResponsibleContactsPanel";
import SummaryCards from "@/components/SummaryCards";
import PendingTransactionsPanel from "@/components/PendingTransactionsPanel";
import CategoryChart from "@/components/CategoryChart";
import TrendChart from "@/components/TrendChart";
import ConfirmDialog from "@/components/ConfirmDialog";
import Tabs from "@/components/Tabs";
import TestDataCleanupPanel from "@/components/TestDataCleanupPanel";
import DeductionRoundsPanel from "@/components/DeductionRoundsPanel";
import OrganizationUnitsPanel from "@/components/OrganizationUnitsPanel";
import StatementReconcilePanel from "@/components/StatementReconcilePanel";
import DailyReconcilePanel from "@/components/DailyReconcilePanel";
import LineGroupsPanel from "@/components/LineGroupsPanel";
import MemberBankAccountsPanel from "@/components/MemberBankAccountsPanel";

const PAGE_SIZE = 10;
const EXPORT_PAGE_SIZE = 100;

const EMPTY_SUMMARY: ExpenseSummary = {
  total: 0,
  thisMonth: 0,
  topCategory: null,
  byCategory: [],
  monthlyTrend: [],
};

export default function Dashboard() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<ExpenseSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  // Nothing here ever showed a failed request before: verify and delete threw
  // their responses away, so a refused action looked exactly like a button
  // that did nothing. A ฿1,800,000 deposit sat in the review queue because of
  // it — the server was explaining the problem to no one.
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Expense | null>(null);
  const [pendingVerify, setPendingVerify] = useState<Expense | null>(null);
  const [filters, setFilters] = useState<Filters>(() => {
    const today = toIso(new Date());
    return { category: "All", from: today, to: today, verified: "" };
  });

  const buildParams = useCallback(
    (extra?: Record<string, string>, options?: { includeDate?: boolean }) => {
      const params = new URLSearchParams();
      if (filters.category !== "All") params.set("category", filters.category);
      if (options?.includeDate !== false) {
        if (filters.from) params.set("from", filters.from);
        if (filters.to) params.set("to", filters.to);
      }
      if (filters.verified) params.set("verified", filters.verified);
      if (extra) {
        for (const [key, value] of Object.entries(extra)) params.set(key, value);
      }
      return params;
    },
    [filters]
  );

  // The list (current page only) and the summary (totals/charts over every
  // matching row) are separate, lightweight server-side queries instead of
  // fetching the entire filtered table and aggregating it in the browser.
  // The summary cards intentionally ignore the date range specifically (still
  // respect category/verified) — "ยอดรวมทั้งหมด"/"เดือนนี้"/the charts are
  // meant to always show the true overall picture, not silently shrink to
  // match whatever date range the list below happens to be scoped to (the
  // list defaults to "today" — see filters' initial state).
  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    const [listRes, summaryRes] = await Promise.all([
      fetch(
        `/api/expenses?${buildParams({
          page: String(page),
          pageSize: String(PAGE_SIZE),
        }).toString()}`
      ),
      fetch(`/api/expenses/summary?${buildParams(undefined, { includeDate: false }).toString()}`),
    ]);
    const listData = await listRes.json();
    const summaryData = await summaryRes.json();
    setExpenses(listData.data);
    setTotal(listData.total);
    setSummary(summaryData);
    setLoading(false);

    const totalPages = Math.max(1, Math.ceil(listData.total / PAGE_SIZE));
    if (page > totalPages) setPage(totalPages);
  }, [buildParams, page]);

  useEffect(() => {
    fetchExpenses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchExpenses]);

  useEffect(() => {
    setPage(1);
  }, [filters]);

  const handleSave = async (data: ExpenseFormData) => {
    const url = editingExpense
      ? `/api/expenses/${editingExpense.id}`
      : "/api/expenses";
    const method = editingExpense ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "บันทึกรายการไม่สำเร็จ");
    }

    setEditingExpense(null);
    // Jump back to page 1 so the newly added/edited row is visible; if
    // already there, page won't change on its own so fetch explicitly.
    if (page === 1) {
      await fetchExpenses();
    } else {
      setPage(1);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    setActionError(null);
    const res = await fetch(`/api/expenses/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setActionError(body.error || "ลบรายการไม่สำเร็จ");
      return;
    }
    if (editingExpense?.id === id) setEditingExpense(null);
    await fetchExpenses();
  };

  const handleConfirmVerify = async () => {
    if (!pendingVerify) return;
    const id = pendingVerify.id;
    setPendingVerify(null);
    setActionError(null);
    const res = await fetch(`/api/expenses/${id}/verify`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setActionError(body.error || "ยืนยันตัวตนไม่สำเร็จ");
      return;
    }
    await fetchExpenses();
  };

  // CSV export needs every matching row, not just the current page — walk
  // pages of the same filtered query instead of relying on state.
  const handleExportCsv = async () => {
    const all: Expense[] = [];
    let exportPage = 1;
    for (;;) {
      const params = buildParams({
        page: String(exportPage),
        pageSize: String(EXPORT_PAGE_SIZE),
      });
      const res = await fetch(`/api/expenses?${params.toString()}`);
      const data = await res.json();
      all.push(...data.data);
      if (data.data.length === 0 || all.length >= data.total) break;
      exportPage += 1;
    }
    downloadExpensesCsv(all);
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold">
          สหกรณ์ออมทรัพย์ครูหนองคาย จำกัด
        </h1>
        <p className="text-slate-500">
          แดชบอร์ดเจ้าหน้าที่ — ธุรกรรมสมาชิกผ่าน LINE Bot, คิวตรวจสอบตัวตน และทะเบียนคำขอบริการ
        </p>
      </header>

      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 whitespace-pre-line">
          {actionError}
          <button
            onClick={() => setActionError(null)}
            className="ml-3 text-red-600 hover:underline"
          >
            ปิด
          </button>
        </div>
      )}

      <Tabs
        defaultTab="transactions"
        tabs={[
          {
            id: "transactions",
            label: "ธุรกรรม",
            content: (
              <div className="space-y-6">
                <SummaryCards summary={summary} />

                <PendingTransactionsPanel />

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <CategoryChart data={summary.byCategory} />
                  <TrendChart data={summary.monthlyTrend} />
                </div>

                <ExpenseFilters filters={filters} onChange={setFilters} />

                {loading ? (
                  <p className="text-slate-500 text-center py-8">กำลังโหลด…</p>
                ) : (
                  <ExpenseList
                    expenses={expenses}
                    total={total}
                    page={page}
                    pageSize={PAGE_SIZE}
                    onPageChange={setPage}
                    onEdit={setEditingExpense}
                    onDeleteRequest={setPendingDelete}
                    onVerifyRequest={setPendingVerify}
                    onExportCsv={handleExportCsv}
                  />
                )}

                <ExpenseForm
                  editingExpense={editingExpense}
                  onSave={handleSave}
                  onCancelEdit={() => setEditingExpense(null)}
                />
              </div>
            ),
          },
          {
            id: "daily",
            label: "เงินเข้าประจำวัน",
            content: <DailyReconcilePanel />,
          },
          {
            id: "service-requests",
            label: "คำขอบริการ",
            content: <ServiceRequestsPanel />,
          },
          {
            id: "statement",
            label: "เทียบ Statement",
            content: (
              <div className="space-y-6">
                <StatementReconcilePanel />
                <MemberBankAccountsPanel />
              </div>
            ),
          },
          {
            id: "deductions",
            label: "รายการหัก",
            content: (
              <div className="space-y-6">
                <DeductionRoundsPanel />
                <OrganizationUnitsPanel />
              </div>
            ),
          },
          {
            id: "line-users",
            label: "สมาชิก LINE",
            content: (
              <div className="space-y-6">
                <LineUsersPanel />
                <MemberContactPanel />
                <TestDataCleanupPanel />
              </div>
            ),
          },
          {
            id: "contacts",
            label: "ผู้รับผิดชอบ",
            content: (
              <div className="space-y-6">
                <LineGroupsPanel />
                <ResponsibleContactsPanel />
                <DepartmentContactsPanel />
              </div>
            ),
          },
          {
            id: "settings",
            label: "ตั้งค่าระบบ",
            content: <FeatureFlagsPanel />,
          },
          {
            id: "knowledge",
            label: "ฐานความรู้",
            content: (
              <div className="space-y-6">
                <KnowledgePanel />
                <FormLinksPanel />
              </div>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="ลบรายการนี้?"
        description={
          pendingDelete
            ? `${pendingDelete.category} · ${formatAmount(pendingDelete.amount)}${
                pendingDelete.description ? ` · ${pendingDelete.description}` : ""
              }`
            : undefined
        }
        confirmLabel="ลบ"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={pendingVerify !== null}
        title="ยืนยันตัวตนสมาชิก?"
        description={
          pendingVerify
            ? `ยืนยันว่า ${pendingVerify.memberFullName ?? "สมาชิก"} (เลขสมาชิก ${
                pendingVerify.memberNumber ?? "-"
              }) เป็นสมาชิกจริง — ระบบจะเพิ่มเข้าทะเบียนสมาชิก และรายการอื่นของเลขสมาชิกนี้จะถูกยืนยันให้ด้วย`
            : undefined
        }
        confirmLabel="ยืนยันตัวตน"
        onConfirm={handleConfirmVerify}
        onCancel={() => setPendingVerify(null)}
      />
    </div>
  );
}
