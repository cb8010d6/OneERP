"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertCircle,
  Building2,
  Loader2,
  ReceiptText,
  RefreshCw,
} from "lucide-react";
import api from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useI18n, type Language } from "@/lib/i18n";

type SupplierOption = {
  id: string;
  code: string | null;
  name: string;
  type: string;
};

type SupplierStatementLine = {
  sourceType: "PURCHASE_INVOICE" | "SUPPLIER_PAYMENT" | "SUPPLIER_CREDIT_NOTE";
  sourceId: string;
  documentNo: string;
  date: string;
  description: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
};

type SupplierStatementPartner = {
  supplierId: string;
  supplierCode: string | null;
  supplierName: string;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  endingBalance: number;
  lines: SupplierStatementLine[];
};

type SupplierStatementData = {
  startDate: string | null;
  endDate: string;
  supplierId: string | null;
  totalOpeningBalance: number;
  totalDebit: number;
  totalCredit: number;
  totalEndingBalance: number;
  suppliers: SupplierStatementPartner[];
};

function inputDateValue(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function monthStart() {
  const now = new Date();
  return inputDateValue(new Date(now.getFullYear(), now.getMonth(), 1));
}

function monthEnd() {
  const now = new Date();
  return inputDateValue(new Date(now.getFullYear(), now.getMonth() + 1, 0));
}

function readApiError(reason: unknown, fallback: string) {
  if (reason && typeof reason === "object" && "response" in reason) {
    const response = (reason as { response?: { data?: { message?: unknown } } })
      .response;
    if (typeof response?.data?.message === "string") {
      return response.data.message;
    }
  }
  return fallback;
}

function dateText(value: string) {
  return value.slice(0, 10);
}

function money(value: number, language: Language) {
  return value === 0 ? "-" : formatCurrency(value, language);
}

function sourceTypeLabel(
  sourceType: SupplierStatementLine["sourceType"],
  t: ReturnType<typeof useI18n>["t"],
) {
  if (sourceType === "SUPPLIER_PAYMENT") {
    return t("supplierStatementPayment");
  }
  if (sourceType === "SUPPLIER_CREDIT_NOTE") {
    return t("supplierStatementCreditNote");
  }
  return t("supplierStatementInvoice");
}

export function SupplierStatementView() {
  const { t, language } = useI18n();
  const [startDate, setStartDate] = useState(monthStart());
  const [endDate, setEndDate] = useState(monthEnd());
  const [supplierId, setSupplierId] = useState("");
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [data, setData] = useState<SupplierStatementData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [statementResponse, supplierResponse] = await Promise.all([
        api.get<SupplierStatementData>("/purchase/supplier-statement", {
          params: {
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            supplierId: supplierId || undefined,
          },
        }),
        api.get<SupplierOption[]>("/purchase/supplier-options"),
      ]);
      setData(statementResponse.data);
      setSuppliers(supplierResponse.data);
    } catch (reason: unknown) {
      setError(readApiError(reason, t("supplierStatementLoadFailed")));
    } finally {
      setLoading(false);
    }
  }, [endDate, startDate, supplierId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {t("supplierStatementTitle")}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {t("supplierStatementHint")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
            className="min-w-56 rounded-md border border-slate-300 p-2 text-sm"
            aria-label={t("supplierStatementSupplierFilter")}
          >
            <option value="">{t("supplierStatementAllSuppliers")}</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.code ? `${supplier.code} / ` : ""}
                {supplier.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="rounded-md border border-slate-300 p-2 text-sm"
            aria-label={t("supplierStatementStartDate")}
          />
          <input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="rounded-md border border-slate-300 p-2 text-sm"
            aria-label={t("supplierStatementEndDate")}
          />
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t("commonRefresh")}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading && !data ? (
        <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t("loading")}
        </div>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-3 md:grid-cols-5">
            <SummaryTile
              label={t("supplierStatementSupplierCount")}
              value={String(data.suppliers.length)}
              icon={<Building2 className="h-4 w-4" />}
            />
            <SummaryTile
              label={t("supplierStatementOpeningBalance")}
              value={formatCurrency(data.totalOpeningBalance, language)}
              icon={<ReceiptText className="h-4 w-4" />}
            />
            <SummaryTile
              label={t("supplierStatementDebit")}
              value={formatCurrency(data.totalDebit, language)}
              icon={<ReceiptText className="h-4 w-4" />}
            />
            <SummaryTile
              label={t("supplierStatementCredit")}
              value={formatCurrency(data.totalCredit, language)}
              icon={<ReceiptText className="h-4 w-4" />}
            />
            <SummaryTile
              label={t("supplierStatementEndingBalance")}
              value={formatCurrency(data.totalEndingBalance, language)}
              icon={<ReceiptText className="h-4 w-4" />}
            />
          </div>

          {data.suppliers.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
              <AlertCircle className="mb-2 h-5 w-5 text-slate-300" />
              {t("supplierStatementNoRows")}
            </div>
          ) : (
            data.suppliers.map((supplier) => (
              <SupplierStatementTable
                key={supplier.supplierId}
                supplier={supplier}
                language={language}
                t={t}
              />
            ))
          )}
        </>
      ) : null}
    </section>
  );
}

function SummaryTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function SupplierStatementTable({
  supplier,
  language,
  t,
}: {
  supplier: SupplierStatementPartner;
  language: Language;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">
            {supplier.supplierCode ? `${supplier.supplierCode} / ` : ""}
            {supplier.supplierName}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {t("supplierStatementSupplier")}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-right text-xs text-slate-500 md:grid-cols-4">
          <span>
            {t("supplierStatementOpeningBalance")}:{" "}
            <strong className="text-slate-900">
              {formatCurrency(supplier.openingBalance, language)}
            </strong>
          </span>
          <span>
            {t("supplierStatementDebit")}:{" "}
            <strong className="text-slate-900">
              {formatCurrency(supplier.periodDebit, language)}
            </strong>
          </span>
          <span>
            {t("supplierStatementCredit")}:{" "}
            <strong className="text-slate-900">
              {formatCurrency(supplier.periodCredit, language)}
            </strong>
          </span>
          <span>
            {t("supplierStatementEndingBalance")}:{" "}
            <strong className="text-slate-900">
              {formatCurrency(supplier.endingBalance, language)}
            </strong>
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[860px] divide-y divide-slate-200 text-sm">
          <thead className="bg-white text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">{t("date")}</th>
              <th className="px-3 py-2 text-left">
                {t("supplierStatementDocument")}
              </th>
              <th className="px-3 py-2 text-left">
                {t("supplierStatementType")}
              </th>
              <th className="px-3 py-2 text-left">
                {t("supplierStatementDescription")}
              </th>
              <th className="px-3 py-2 text-right">
                {t("supplierStatementDebit")}
              </th>
              <th className="px-3 py-2 text-right">
                {t("supplierStatementCredit")}
              </th>
              <th className="px-3 py-2 text-right">
                {t("supplierStatementRunningBalance")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {supplier.lines.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-8 text-center text-sm text-slate-500"
                >
                  {t("supplierStatementNoRows")}
                </td>
              </tr>
            ) : (
              supplier.lines.map((line) => (
                <tr key={`${line.sourceType}-${line.sourceId}`}>
                  <td className="px-3 py-2 text-slate-700">
                    {dateText(line.date)}
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-900">
                    {line.documentNo}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {sourceTypeLabel(line.sourceType, t)}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {line.description ?? "-"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">
                    {money(line.debit, language)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">
                    {money(line.credit, language)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-slate-950">
                    {formatCurrency(line.runningBalance, language)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
