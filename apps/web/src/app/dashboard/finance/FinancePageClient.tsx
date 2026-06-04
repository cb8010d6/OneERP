"use client";

import { useMemo, useState } from "react";
import { DynamicView } from "@/components/core";
import { DocumentDraftUploader } from "@/components/ai/DocumentDraftUploader";
import { TrialBalanceView } from "./TrialBalanceView";
import { FinanceDlqCenter } from "./FinanceDlqCenter";
import { FinanceActionsPanel } from "./FinanceActionsPanel";
import { FinanceAccountMappingsPanel } from "./FinanceAccountMappingsPanel";
import { ReceivablePaymentWorkbench } from "./ReceivablePaymentWorkbench";
import { PayablePaymentWorkbench } from "./PayablePaymentWorkbench";
import { ReceivablesAgingView } from "./ReceivablesAgingView";
import { CreditNotePanel } from "./CreditNotePanel";
import { InventoryValuationView } from "./InventoryValuationView";
import { AccountingPeriodsPanel } from "./AccountingPeriodsPanel";
import { BankReconciliationPanel } from "./BankReconciliationPanel";
import {
  FileText,
  BarChart3,
  AlertTriangle,
  CalendarClock,
  PackageSearch,
  LockKeyhole,
  Landmark,
  BanknoteArrowUp,
} from "lucide-react";
import { clsx } from "clsx";
import { useI18n } from "@/lib/i18n";

export default function FinancePageClient() {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [activeTab, setActiveTab] = useState<
    | "invoices"
    | "payables"
    | "trial-balance"
    | "aging"
    | "inventory"
    | "bank"
    | "periods"
    | "dlq"
  >("invoices");

  const preview = useMemo(() => {
    if (!draft) return [] as Array<{ key: string; value: string }>;
    return Object.entries(draft)
      .slice(0, 6)
      .map(([key, value]) => ({
        key,
        value:
          typeof value === "object" ? JSON.stringify(value) : String(value),
      }));
  }, [draft]);

  return (
    <div className="space-y-6">
      {/* 顶部标签页切换 */}
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
          <button
            onClick={() => setActiveTab("invoices")}
            className={clsx(
              "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all",
              activeTab === "invoices"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            <FileText className="h-4 w-4" />
            {t("financeInvoices")}
          </button>
          <button
            onClick={() => setActiveTab("trial-balance")}
            className={clsx(
              "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all",
              activeTab === "trial-balance"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            <BarChart3 className="h-4 w-4" />
            {t("financeTrialBalance")}
          </button>
          <button
            onClick={() => setActiveTab("payables")}
            className={clsx(
              "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all",
              activeTab === "payables"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            <BanknoteArrowUp className="h-4 w-4" />
            {t("financePayablesTab")}
          </button>
          <button
            onClick={() => setActiveTab("aging")}
            className={clsx(
              "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all",
              activeTab === "aging"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            <CalendarClock className="h-4 w-4" />
            {t("financeAgingTab")}
          </button>
          <button
            onClick={() => setActiveTab("inventory")}
            className={clsx(
              "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all",
              activeTab === "inventory"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            <PackageSearch className="h-4 w-4" />
            {t("financeInventoryValuationTab")}
          </button>
          <button
            onClick={() => setActiveTab("periods")}
            className={clsx(
              "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all",
              activeTab === "periods"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            <LockKeyhole className="h-4 w-4" />
            {t("financePeriodsTab")}
          </button>
          <button
            onClick={() => setActiveTab("bank")}
            className={clsx(
              "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all",
              activeTab === "bank"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            <Landmark className="h-4 w-4" />
            {t("financeBankReconciliationTab")}
          </button>
          <button
            onClick={() => setActiveTab("dlq")}
            className={clsx(
              "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all",
              activeTab === "dlq"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            <AlertTriangle className="h-4 w-4" />
            {t("financeDlqTab")}
          </button>
        </div>
      </div>

      {activeTab === "invoices" ? (
        <div className="space-y-4 animate-in fade-in slide-in-from-left-2 duration-300">
          <FinanceAccountMappingsPanel />
          <ReceivablePaymentWorkbench />
          <CreditNotePanel />
          <FinanceActionsPanel />
          <DocumentDraftUploader
            onDraftReady={(nextDraft) => setDraft(nextDraft)}
          />

          {draft ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
              <p className="text-sm font-medium text-amber-900">
                {t("financeDraftReady")}
              </p>
              <div className="mt-2 grid gap-2 text-xs text-amber-800 md:grid-cols-2">
                {preview.map((item) => (
                  <div
                    key={item.key}
                    className="rounded bg-white/80 px-2 py-1 shadow-sm border border-amber-100"
                  >
                    <span className="font-semibold">{item.key}:</span>{" "}
                    {item.value}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <DynamicView
            modelName="invoice"
            title={t("financeInvoiceManagement")}
            externalDraft={draft}
          />
        </div>
      ) : activeTab === "trial-balance" ? (
        <div className="animate-in fade-in slide-in-from-right-2 duration-300">
          <TrialBalanceView />
        </div>
      ) : activeTab === "payables" ? (
        <div className="animate-in fade-in slide-in-from-right-2 duration-300">
          <PayablePaymentWorkbench />
        </div>
      ) : activeTab === "aging" ? (
        <div className="animate-in fade-in slide-in-from-right-2 duration-300">
          <ReceivablesAgingView />
        </div>
      ) : activeTab === "inventory" ? (
        <div className="animate-in fade-in slide-in-from-right-2 duration-300">
          <InventoryValuationView
            onOpenDlq={() => setActiveTab("dlq")}
            onOpenTrialBalance={() => setActiveTab("trial-balance")}
          />
        </div>
      ) : activeTab === "periods" ? (
        <div className="animate-in fade-in slide-in-from-right-2 duration-300">
          <AccountingPeriodsPanel />
        </div>
      ) : activeTab === "bank" ? (
        <div className="animate-in fade-in slide-in-from-right-2 duration-300">
          <BankReconciliationPanel />
        </div>
      ) : (
        <FinanceDlqCenter />
      )}
    </div>
  );
}
