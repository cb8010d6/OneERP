"use client";

import { type ComponentType, useMemo, useState } from "react";
import { DynamicView } from "@/components/core";
import { DocumentDraftUploader } from "@/components/ai/DocumentDraftUploader";
import { TrialBalanceView } from "./TrialBalanceView";
import { GeneralLedgerView } from "./GeneralLedgerView";
import { IncomeStatementView } from "./IncomeStatementView";
import { BalanceSheetView } from "./BalanceSheetView";
import { CashFlowStatementView } from "./CashFlowStatementView";
import { FinanceDlqCenter } from "./FinanceDlqCenter";
import { FinanceActionsPanel } from "./FinanceActionsPanel";
import { FinanceAccountMappingsPanel } from "./FinanceAccountMappingsPanel";
import { CustomerStatementView } from "./CustomerStatementView";
import { SupplierStatementView } from "./SupplierStatementView";
import { ReceivablePaymentWorkbench } from "./ReceivablePaymentWorkbench";
import { PayablePaymentWorkbench } from "./PayablePaymentWorkbench";
import { ReceivablesAgingView } from "./ReceivablesAgingView";
import { CreditNotePanel } from "./CreditNotePanel";
import { InventoryValuationView } from "./InventoryValuationView";
import { AccountingPeriodsPanel } from "./AccountingPeriodsPanel";
import { BankReconciliationPanel } from "./BankReconciliationPanel";
import {
  FileText,
  BookOpen,
  BarChart3,
  Building2,
  LineChart,
  Scale,
  WalletCards,
  AlertTriangle,
  CalendarClock,
  PackageSearch,
  LockKeyhole,
  Landmark,
  BanknoteArrowUp,
  Users,
} from "lucide-react";
import { clsx } from "clsx";
import { useI18n } from "@/lib/i18n";

type FinanceTab =
  | "invoices"
  | "customer-statement"
  | "supplier-statement"
  | "payables"
  | "trial-balance"
  | "general-ledger"
  | "income-statement"
  | "balance-sheet"
  | "cash-flow"
  | "aging"
  | "inventory"
  | "bank"
  | "periods"
  | "dlq";

type FinanceTabItem = {
  id: FinanceTab;
  label: string;
  Icon: ComponentType<{ className?: string }>;
};

export default function FinancePageClient() {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [activeTab, setActiveTab] = useState<FinanceTab>("invoices");

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

  const tabs = useMemo<FinanceTabItem[]>(
    () => [
      { id: "invoices", label: t("financeInvoices"), Icon: FileText },
      {
        id: "customer-statement",
        label: t("financeCustomerStatementTab"),
        Icon: Users,
      },
      {
        id: "supplier-statement",
        label: t("financeSupplierStatementTab"),
        Icon: Building2,
      },
      { id: "payables", label: t("financePayablesTab"), Icon: BanknoteArrowUp },
      {
        id: "trial-balance",
        label: t("financeTrialBalance"),
        Icon: BarChart3,
      },
      {
        id: "general-ledger",
        label: t("financeGeneralLedgerTab"),
        Icon: BookOpen,
      },
      {
        id: "income-statement",
        label: t("financeIncomeStatementTab"),
        Icon: LineChart,
      },
      {
        id: "balance-sheet",
        label: t("financeBalanceSheetTab"),
        Icon: Scale,
      },
      { id: "cash-flow", label: t("financeCashFlowTab"), Icon: WalletCards },
      { id: "aging", label: t("financeAgingTab"), Icon: CalendarClock },
      {
        id: "inventory",
        label: t("financeInventoryValuationTab"),
        Icon: PackageSearch,
      },
      { id: "periods", label: t("financePeriodsTab"), Icon: LockKeyhole },
      { id: "bank", label: t("financeBankReconciliationTab"), Icon: Landmark },
      { id: "dlq", label: t("financeDlqTab"), Icon: AlertTriangle },
    ],
    [t],
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* 顶部标签页切换 */}
      <div className="min-w-0">
        <select
          value={activeTab}
          onChange={(event) => setActiveTab(event.target.value as FinanceTab)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-100 sm:hidden"
        >
          {tabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.label}
            </option>
          ))}
        </select>

        <div className="hidden min-w-0 overflow-x-auto rounded-lg bg-slate-100 p-1 sm:flex sm:items-center sm:gap-1">
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={clsx(
                "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all lg:px-4",
                activeTab === id
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="whitespace-nowrap">{label}</span>
            </button>
          ))}
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
      ) : activeTab === "customer-statement" ? (
        <div className="animate-in fade-in slide-in-from-right-2 duration-300">
          <CustomerStatementView />
        </div>
      ) : activeTab === "supplier-statement" ? (
        <div className="animate-in fade-in slide-in-from-right-2 duration-300">
          <SupplierStatementView />
        </div>
      ) : activeTab === "trial-balance" ? (
        <div className="animate-in fade-in slide-in-from-right-2 duration-300">
          <TrialBalanceView />
        </div>
      ) : activeTab === "general-ledger" ? (
        <div className="animate-in fade-in slide-in-from-right-2 duration-300">
          <GeneralLedgerView />
        </div>
      ) : activeTab === "payables" ? (
        <div className="animate-in fade-in slide-in-from-right-2 duration-300">
          <PayablePaymentWorkbench />
        </div>
      ) : activeTab === "income-statement" ? (
        <div className="animate-in fade-in slide-in-from-right-2 duration-300">
          <IncomeStatementView />
        </div>
      ) : activeTab === "balance-sheet" ? (
        <div className="animate-in fade-in slide-in-from-right-2 duration-300">
          <BalanceSheetView />
        </div>
      ) : activeTab === "cash-flow" ? (
        <div className="animate-in fade-in slide-in-from-right-2 duration-300">
          <CashFlowStatementView />
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
