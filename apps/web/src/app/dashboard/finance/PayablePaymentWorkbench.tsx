"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BanknoteArrowUp, Loader2, RefreshCw, Wand2 } from "lucide-react";
import api from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuthStore } from "@/store/authStore";

type PayableRow = {
  purchaseInvoiceId: string;
  invoiceNo: string;
  purchaseNo: string;
  supplierId: string;
  supplierName: string;
  issuedDate: string;
  dueDate: string | null;
  daysOverdue: number;
  amount: number;
  creditedAmount: number;
  paidAmount: number;
  openAmount: number;
  status: string;
};

type OpenPayablesResult = {
  rows: PayableRow[];
};

type SupplierOption = {
  id: string;
  name: string;
  openAmount: number;
};

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

function money(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export function PayablePaymentWorkbench() {
  const { t } = useI18n();
  const { currentCompanyId } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [rows, setRows] = useState<PayableRow[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("BANK_TRANSFER");
  const [paymentDate, setPaymentDate] = useState(todayInputValue());
  const [note, setNote] = useState("");
  const [allocatedByInvoice, setAllocatedByInvoice] = useState<
    Record<string, number>
  >({});

  const suppliers = useMemo<SupplierOption[]>(() => {
    const bySupplier = new Map<string, SupplierOption>();
    for (const row of rows) {
      const existing = bySupplier.get(row.supplierId);
      if (existing) {
        existing.openAmount = round2(existing.openAmount + row.openAmount);
        continue;
      }
      bySupplier.set(row.supplierId, {
        id: row.supplierId,
        name: row.supplierName,
        openAmount: row.openAmount,
      });
    }
    return [...bySupplier.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const supplierRows = useMemo(
    () => rows.filter((row) => row.supplierId === selectedSupplierId),
    [rows, selectedSupplierId],
  );

  const selectedTotal = useMemo(
    () =>
      round2(
        supplierRows.reduce(
          (sum, row) =>
            sum + (allocatedByInvoice[row.purchaseInvoiceId] ?? 0),
          0,
        ),
      ),
    [allocatedByInvoice, supplierRows],
  );

  const unappliedAmount = round2(Math.max(paymentAmount - selectedTotal, 0));

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    setLoading(true);
    setError("");
    try {
      const response = await api.get<OpenPayablesResult>(
        "/purchase/open-payables",
      );
      const openRows = response.data.rows.filter((row) => row.openAmount > 0);
      setRows(openRows);
      setSelectedSupplierId((prev) => {
        if (prev && openRows.some((row) => row.supplierId === prev)) {
          return prev;
        }
        return openRows[0]?.supplierId ?? "";
      });
      setAllocatedByInvoice({});
      setPaymentAmount(0);
      setPaymentDate(todayInputValue());
    } catch (reason: unknown) {
      setError(readApiError(reason, t("payableWorkbenchLoadFailed")));
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const autoAllocateAll = () => {
    const next: Record<string, number> = {};
    for (const row of supplierRows) {
      if (row.openAmount > 0) {
        next[row.purchaseInvoiceId] = round2(row.openAmount);
      }
    }
    setAllocatedByInvoice(next);
    setPaymentAmount(
      round2(Object.values(next).reduce((sum, amount) => sum + amount, 0)),
    );
  };

  const setAllocation = (purchaseInvoiceId: string, value: number) => {
    const row = supplierRows.find(
      (item) => item.purchaseInvoiceId === purchaseInvoiceId,
    );
    const bounded = Math.min(Math.max(round2(value), 0), row?.openAmount ?? 0);
    setAllocatedByInvoice((prev) => ({
      ...prev,
      [purchaseInvoiceId]: bounded,
    }));
  };

  const clearAllocation = (purchaseInvoiceId: string) => {
    setAllocatedByInvoice((prev) => {
      const next = { ...prev };
      delete next[purchaseInvoiceId];
      return next;
    });
  };

  const submit = async () => {
    const allocations = supplierRows
      .map((row) => ({
        purchaseInvoiceId: row.purchaseInvoiceId,
        amount: round2(allocatedByInvoice[row.purchaseInvoiceId] ?? 0),
      }))
      .filter((allocation) => allocation.amount > 0);

    if (!selectedSupplierId || paymentAmount <= 0) {
      setError(t("payableWorkbenchPaymentRequired"));
      return;
    }
    if (paymentAmount < selectedTotal) {
      setError(t("payableWorkbenchPaymentBelowAllocation"));
      return;
    }
    if (allocations.length === 0) {
      setError(t("payableWorkbenchSelectInvoices"));
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const createResponse = await api.post<{ id: string }>(
        "/purchase/supplier-payments",
        {
          supplierId: selectedSupplierId,
          amount: paymentAmount,
          method: paymentMethod,
          paymentDate,
          note: note || undefined,
          allocations,
        },
      );
      await api.post(`/purchase/supplier-payments/${createResponse.data.id}/post`);
      setMessage(t("payableWorkbenchSaved"));
      setNote("");
      await load();
    } catch (reason: unknown) {
      setError(readApiError(reason, t("payableWorkbenchSaveFailed")));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center text-sm text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {t("loading")}
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {t("payableWorkbenchTitle")}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {t("payableWorkbenchHint")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
          title={t("commonRefresh")}
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {error ? (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {message}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto_auto]">
        <select
          value={selectedSupplierId}
          onChange={(event) => {
            setSelectedSupplierId(event.target.value);
            setAllocatedByInvoice({});
            setPaymentAmount(0);
          }}
          className="rounded-md border border-slate-300 p-2 text-sm"
        >
          <option value="">{t("payableWorkbenchSelectSupplier")}</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name} / {money(supplier.openAmount)}
            </option>
          ))}
        </select>
        <select
          value={paymentMethod}
          onChange={(event) => setPaymentMethod(event.target.value)}
          className="rounded-md border border-slate-300 p-2 text-sm"
        >
          <option value="BANK_TRANSFER">{t("financePaymentBank")}</option>
          <option value="ALIPAY">{t("financePaymentAlipay")}</option>
          <option value="WECHAT">{t("financePaymentWechat")}</option>
          <option value="CASH">{t("financePaymentCash")}</option>
        </select>
        <input
          type="date"
          value={paymentDate}
          onChange={(event) => setPaymentDate(event.target.value)}
          className="rounded-md border border-slate-300 p-2 text-sm"
        />
        <input
          type="number"
          min="0"
          step="0.01"
          value={paymentAmount}
          onChange={(event) =>
            setPaymentAmount(round2(Number(event.target.value)))
          }
          className="rounded-md border border-slate-300 p-2 text-sm"
          placeholder={t("payableWorkbenchPaymentAmount")}
        />
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="rounded-md border border-slate-300 p-2 text-sm"
          placeholder={t("payableWorkbenchNote")}
        />
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {t("payableWorkbenchAllocated")}: {money(selectedTotal)}
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {t("payableWorkbenchUnapplied")}: {money(unappliedAmount)}
        </div>
        <button
          type="button"
          onClick={autoAllocateAll}
          disabled={!selectedSupplierId || supplierRows.length === 0 || saving}
          className="inline-flex items-center justify-center rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <Wand2 className="mr-2 h-4 w-4" />
          {t("paymentWorkbenchAuto")}
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!selectedSupplierId || paymentAmount <= 0 || saving}
          className="inline-flex items-center justify-center rounded-md bg-sky-700 px-3 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <BanknoteArrowUp className="mr-2 h-4 w-4" />
          )}
          {t("payableWorkbenchSubmit")}
        </button>
      </div>

      <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">
                {t("payableWorkbenchInvoice")}
              </th>
              <th className="px-3 py-2 text-right">
                {t("payableWorkbenchOpen")}
              </th>
              <th className="px-3 py-2 text-right">
                {t("payableWorkbenchDaysOverdue")}
              </th>
              <th className="px-3 py-2 text-right">
                {t("payableWorkbenchAllocation")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {supplierRows.map((row) => {
              const allocated = allocatedByInvoice[row.purchaseInvoiceId] ?? 0;
              return (
                <tr key={row.purchaseInvoiceId} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">
                      {row.invoiceNo}
                    </div>
                    <div className="text-xs text-slate-500">
                      {row.purchaseNo} / {row.dueDate?.slice(0, 10) ?? "-"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">
                    {money(row.openAmount)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">
                    {row.daysOverdue}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        max={row.openAmount}
                        value={allocated}
                        onChange={(event) =>
                          setAllocation(
                            row.purchaseInvoiceId,
                            Number(event.target.value),
                          )
                        }
                        className="w-32 rounded-md border border-slate-300 p-2 text-right text-sm"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          allocated > 0
                            ? clearAllocation(row.purchaseInvoiceId)
                            : setAllocation(row.purchaseInvoiceId, row.openAmount)
                        }
                        className="rounded-md border border-slate-300 px-2 py-2 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        {allocated > 0
                          ? t("paymentWorkbenchClear")
                          : t("paymentWorkbenchUseOpen")}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {selectedSupplierId && supplierRows.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-8 text-center text-sm text-slate-500"
                >
                  {t("payableWorkbenchNoInvoices")}
                </td>
              </tr>
            ) : null}
            {!selectedSupplierId ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-8 text-center text-sm text-slate-500"
                >
                  {t("payableWorkbenchNoSupplier")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
