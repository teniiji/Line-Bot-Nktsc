"use client";

import { useCallback, useEffect, useState } from "react";
import { Expense, ExpenseSummary } from "@/lib/types";
import { formatAmount } from "@/lib/format";
import { downloadExpensesCsv } from "@/lib/csv";
import ExpenseForm, { ExpenseFormData } from "@/components/ExpenseForm";
import ExpenseFilters, { Filters } from "@/components/ExpenseFilters";
import ExpenseList from "@/components/ExpenseList";
import LineUsersPanel from "@/components/LineUsersPanel";
import MemberContactPanel from "@/components/MemberContactPanel";
import ServiceRequestsPanel from "@/components/ServiceRequestsPanel";
import KnowledgePanel from "@/components/KnowledgePanel";
import DepartmentContactsPanel from "@/components/DepartmentContactsPanel";
import ResponsibleContactsPanel from "@/components/ResponsibleContactsPanel";
import SummaryCards from "@/components/SummaryCards";
import CategoryChart from "@/components/CategoryChart";
import TrendChart from "@/components/TrendChart";
import ConfirmDialog from "@/components/ConfirmDialog";
import Tabs from "@/components/Tabs";
import TestDataCleanupPanel from "@/components/TestDataCleanupPanel";

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
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Expense | null>(null);
  const [pendingVerify, setPendingVerify] = useState<Expense | null>(null);
  const [filters, setFilters] = useState<Filters>({
    category: "All",
    from: "",
    to: "",
    verified: "",
  });

  const buildParams = useCallback(
    (extra?: Record<string, string>) => {
      const params = new URLSearchParams();
      if (filters.category !== "All") params.set("category", filters.category);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
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
  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    const [listRes, summaryRes] = await Promise.all([
      fetch(
        `/api/expenses?${buildParams({
          page: String(page),
          pageSize: String(PAGE_SIZE),
        }).toString()}`
      ),
      fetch(`/api/expenses/summary?${buildParams().toString()}`),
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
    await fetch(`/api/expenses/${id}`, { method: "DELETE" });
    if (editingExpense?.id === id) setEditingExpense(null);
    await fetchExpenses();
  };

  const handleConfirmVerify = async () => {
    if (!pendingVerify) return;
    const id = pendingVerify.id;
    setPendingVerify(null);
    await fetch(`/api/expenses/${id}/verify`, { method: "POST" });
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

      <Tabs
        defaultTab="transactions"
        tabs={[
          {
            id: "transactions",
            label: "ธุรกรรม",
            content: (
              <div className="space-y-6">
                <SummaryCards summary={summary} />

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
            id: "service-requests",
            label: "คำขอบริการ",
            content: <ServiceRequestsPanel />,
          },
          {
            id: "contacts",
            label: "ผู้รับผิดชอบ",
            content: (
              <div className="space-y-6">
                <ResponsibleContactsPanel />
                <DepartmentContactsPanel />
              </div>
            ),
          },
          {
            id: "knowledge",
            label: "ฐานความรู้",
            content: <KnowledgePanel />,
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
