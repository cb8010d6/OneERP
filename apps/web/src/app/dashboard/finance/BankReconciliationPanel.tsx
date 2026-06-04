"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import api from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type BankStatementLineStatus = "UNMATCHED" | "MATCHED";
type MatchTargetType = "CUSTOMER_PAYMENT" | "SUPPLIER_PAYMENT";

type BankStatementLine = {
  id: string;
  bankAccount?: string | null;
  transactionDate: string;
  description?: string | null;
  counterparty?: string | null;
  amount: number | string;
  externalRef?: string | null;
  status: BankStatementLineStatus;
  paymentId?: string | null;
  supplierPaymentId?: string | null;
  matchedAt?: string | null;
};

type BankStatementResponse = {
  rows: BankStatementLine[];
};

type ImportForm = {
  bankAccount: string;
  transactionDate: string;
  description: string;
  counterparty: string;
  amount: string;
  externalRef: string;
};

type MatchDraft = {
  targetType: MatchTargetType;
  targetId: string;
};

function todayInput() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function money(value: number | string) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function dateText(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function BankReconciliationPanel() {
  const { t } = useI18n();
  const [status, setStatus] = useState<"" | BankStatementLineStatus>(
    "UNMATCHED",
  );
  const [rows, setRows] = useState<BankStatementLine[]>([]);
  const [form, setForm] = useState<ImportForm>({
    bankAccount: "",
    transactionDate: todayInput(),
    description: "",
    counterparty: "",
    amount: "",
    externalRef: "",
  });
  const [matchDrafts, setMatchDrafts] = useState<Record<string, MatchDraft>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [matchingId, setMatchingId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const totalUnmatched = useMemo(
    () => rows.filter((row) => row.status === "UNMATCHED").length,
    [rows],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get<BankStatementResponse>(
        "/finance/bank-statements",
        { params: { status: status || undefined } },
      );
      setRows(response.data.rows ?? []);
    } catch {
      setError(t("bankReconciliationLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [status, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const importLine = useCallback(async () => {
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount === 0) {
      setError(t("bankReconciliationAmountInvalid"));
      return;
    }
    setImporting(true);
    setMessage("");
    setError("");
    try {
      const response = await api.post<{
        imported: number;
        skipped: number;
      }>("/finance/bank-statements/import", {
        lines: [
          {
            bankAccount: form.bankAccount || undefined,
            transactionDate: form.transactionDate,
            description: form.description || undefined,
            counterparty: form.counterparty || undefined,
            amount,
            externalRef: form.externalRef || undefined,
          },
        ],
      });
      setMessage(
        `${t("bankReconciliationImported")}: ${response.data.imported}, ${t("bankReconciliationSkipped")}: ${response.data.skipped}`,
      );
      setForm((current) => ({
        ...current,
        description: "",
        counterparty: "",
        amount: "",
        externalRef: "",
      }));
      await load();
    } catch {
      setError(t("bankReconciliationImportFailed"));
    } finally {
      setImporting(false);
    }
  }, [form, load, t]);

  const matchLine = useCallback(
    async (line: BankStatementLine) => {
      const draft = matchDrafts[line.id] ?? {
        targetType: Number(line.amount) >= 0
          ? "CUSTOMER_PAYMENT"
          : "SUPPLIER_PAYMENT",
        targetId: "",
      };
      if (!draft.targetId.trim()) {
        setError(t("bankReconciliationTargetRequired"));
        return;
      }
      setMatchingId(line.id);
      setMessage("");
      setError("");
      try {
        await api.post(`/finance/bank-statements/${line.id}/match`, draft);
        setMessage(t("bankReconciliationMatched"));
        await load();
      } catch {
        setError(t("bankReconciliationMatchFailed"));
      } finally {
        setMatchingId("");
      }
    },
    [load, matchDrafts, t],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {t("bankReconciliationTitle")}
          </h2>
          <p className="text-sm text-slate-500">
            {t("bankReconciliationSubtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {t("refresh")}
        </button>
      </div>

      {message ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="rounded-md border border-slate-200 bg-white">
        <div className="grid gap-3 border-b border-slate-100 p-3 md:grid-cols-6">
          <input
            type="text"
            value={form.bankAccount}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                bankAccount: event.target.value,
              }))
            }
            placeholder={t("bankReconciliationBankAccount")}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={form.transactionDate}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                transactionDate: event.target.value,
              }))
            }
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={form.counterparty}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                counterparty: event.target.value,
              }))
            }
            placeholder={t("bankReconciliationCounterparty")}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={form.description}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
            placeholder={t("bankReconciliationDescription")}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            type="number"
            value={form.amount}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                amount: event.target.value,
              }))
            }
            placeholder={t("bankReconciliationAmount")}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={form.externalRef}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  externalRef: event.target.value,
                }))
              }
              placeholder={t("bankReconciliationExternalRef")}
              className="min-w-0 flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => void importLine()}
              disabled={importing}
              className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {importing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
          <select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as "" | BankStatementLineStatus)
            }
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700"
          >
            <option value="UNMATCHED">
              {t("bankReconciliationStatusUnmatched")}
            </option>
            <option value="MATCHED">
              {t("bankReconciliationStatusMatched")}
            </option>
            <option value="">{t("bankReconciliationStatusAll")}</option>
          </select>
          <span className="text-xs text-slate-500">
            {t("bankReconciliationUnmatched")}: {totalUnmatched}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">{t("date")}</th>
                <th className="px-3 py-2">
                  {t("bankReconciliationCounterparty")}
                </th>
                <th className="px-3 py-2">
                  {t("bankReconciliationDescription")}
                </th>
                <th className="px-3 py-2 text-right">
                  {t("bankReconciliationAmount")}
                </th>
                <th className="px-3 py-2">{t("status")}</th>
                <th className="px-3 py-2 text-right">{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((line) => {
                const isInflow = Number(line.amount) >= 0;
                const draft = matchDrafts[line.id] ?? {
                  targetType: isInflow
                    ? "CUSTOMER_PAYMENT"
                    : "SUPPLIER_PAYMENT",
                  targetId: "",
                };
                return (
                  <tr key={line.id}>
                    <td className="px-3 py-2 text-slate-600">
                      {dateText(line.transactionDate)}
                    </td>
                    <td className="px-3 py-2 text-slate-900">
                      {line.counterparty || "-"}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {line.description || line.externalRef || "-"}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono font-semibold ${
                        isInflow ? "text-emerald-700" : "text-red-700"
                      }`}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        {isInflow ? (
                          <ArrowDownLeft className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        )}
                        {money(line.amount)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                          line.status === "MATCHED"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {line.status === "MATCHED" ? (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : null}
                        {line.status === "MATCHED"
                          ? t("bankReconciliationStatusMatched")
                          : t("bankReconciliationStatusUnmatched")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {line.status === "UNMATCHED" ? (
                        <div className="flex justify-end gap-2">
                          <select
                            value={draft.targetType}
                            onChange={(event) =>
                              setMatchDrafts((current) => ({
                                ...current,
                                [line.id]: {
                                  ...draft,
                                  targetType: event.target
                                    .value as MatchTargetType,
                                },
                              }))
                            }
                            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                          >
                            <option value="CUSTOMER_PAYMENT">
                              {t("bankReconciliationCustomerPayment")}
                            </option>
                            <option value="SUPPLIER_PAYMENT">
                              {t("bankReconciliationSupplierPayment")}
                            </option>
                          </select>
                          <input
                            type="text"
                            value={draft.targetId}
                            onChange={(event) =>
                              setMatchDrafts((current) => ({
                                ...current,
                                [line.id]: {
                                  ...draft,
                                  targetId: event.target.value,
                                },
                              }))
                            }
                            placeholder={t("bankReconciliationTargetId")}
                            className="w-40 rounded-md border border-slate-200 px-2 py-1 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => void matchLine(line)}
                            disabled={matchingId === line.id}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                          >
                            {matchingId === line.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            )}
                            {t("bankReconciliationMatch")}
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">
                          {line.paymentId || line.supplierPaymentId || "-"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td
                    className="px-3 py-8 text-center text-slate-500"
                    colSpan={6}
                  >
                    {loading ? t("loading") : t("bankReconciliationEmpty")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
