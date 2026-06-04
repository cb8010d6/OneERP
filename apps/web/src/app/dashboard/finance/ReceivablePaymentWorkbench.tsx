"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, Loader2, RefreshCw, Wand2 } from "lucide-react";
import api from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuthStore } from "@/store/authStore";

type AgingRow = {
  invoiceId: string;
  invoiceNo: string;
  orderNo: string | null;
  partnerId: string | null;
  partnerName: string | null;
  dueDate: string | null;
  daysOverdue: number;
  openAmount: number;
};

type AgingResult = {
  rows: AgingRow[];
};

type UnappliedPayment = {
  paymentId: string;
  partnerId: string;
  partnerName: string;
  paymentDate: string;
  method: string;
  amount: number;
  allocatedAmount: number;
  unappliedAmount: number;
};

type UnappliedPaymentResult = {
  rows: UnappliedPayment[];
};

type CustomerOption = {
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

export function ReceivablePaymentWorkbench() {
  const { t } = useI18n();
  const { currentCompanyId } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [rows, setRows] = useState<AgingRow[]>([]);
  const [unappliedRows, setUnappliedRows] = useState<UnappliedPayment[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [selectedUnappliedPaymentId, setSelectedUnappliedPaymentId] =
    useState("");
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("BANK_TRANSFER");
  const [allocatedByInvoice, setAllocatedByInvoice] = useState<
    Record<string, number>
  >({});

  const customers = useMemo<CustomerOption[]>(() => {
    const byPartner = new Map<string, CustomerOption>();
    for (const row of rows) {
      if (!row.partnerId) continue;
      const existing = byPartner.get(row.partnerId);
      if (existing) {
        existing.openAmount = round2(existing.openAmount + row.openAmount);
        continue;
      }
      byPartner.set(row.partnerId, {
        id: row.partnerId,
        name: row.partnerName ?? row.partnerId,
        openAmount: row.openAmount,
      });
    }
    return [...byPartner.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const customerRows = useMemo(
    () =>
      rows.filter(
        (row) => row.partnerId && row.partnerId === selectedPartnerId,
      ),
    [rows, selectedPartnerId],
  );

  const selectedTotal = useMemo(
    () =>
      round2(
        customerRows.reduce(
          (sum, row) => sum + (allocatedByInvoice[row.invoiceId] ?? 0),
          0,
        ),
      ),
    [allocatedByInvoice, customerRows],
  );
  const unappliedAmount = round2(Math.max(paymentAmount - selectedTotal, 0));
  const customerUnappliedRows = useMemo(
    () =>
      unappliedRows.filter(
        (payment) => payment.partnerId === selectedPartnerId,
      ),
    [selectedPartnerId, unappliedRows],
  );
  const selectedUnappliedPayment = useMemo(
    () =>
      customerUnappliedRows.find(
        (payment) => payment.paymentId === selectedUnappliedPaymentId,
      ),
    [customerUnappliedRows, selectedUnappliedPaymentId],
  );

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    setLoading(true);
    setError("");
    try {
      const [agingResponse, unappliedResponse] = await Promise.all([
        api.get<AgingResult>("/finance/receivables-aging", {
          params: { asOfDate: todayInputValue() },
        }),
        api.get<UnappliedPaymentResult>("/finance/unapplied-payments"),
      ]);
      const openRows = agingResponse.data.rows.filter(
        (row) => row.partnerId && row.openAmount > 0,
      );
      setRows(openRows);
      setUnappliedRows(unappliedResponse.data.rows);
      setSelectedPartnerId((prev) => {
        if (prev && openRows.some((row) => row.partnerId === prev)) {
          return prev;
        }
        return openRows[0]?.partnerId ?? "";
      });
      setAllocatedByInvoice({});
      setPaymentAmount(0);
      setSelectedUnappliedPaymentId("");
    } catch (reason: unknown) {
      setError(readApiError(reason, t("paymentWorkbenchLoadFailed")));
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const autoAllocateAll = () => {
    const next: Record<string, number> = {};
    let remaining = selectedUnappliedPayment?.unappliedAmount ?? Infinity;
    for (const row of customerRows) {
      const amount = Math.min(row.openAmount, remaining);
      if (amount > 0) {
        next[row.invoiceId] = round2(amount);
      }
      remaining = round2(remaining - amount);
    }
    setAllocatedByInvoice(next);
    const nextTotal = round2(
      Object.values(next).reduce((sum, amount) => sum + amount, 0),
    );
    if (!selectedUnappliedPayment) {
      setPaymentAmount(nextTotal);
    }
  };

  const setAllocation = (invoiceId: string, value: number) => {
    const row = customerRows.find((item) => item.invoiceId === invoiceId);
    const bounded = Math.min(Math.max(round2(value), 0), row?.openAmount ?? 0);
    setAllocatedByInvoice((prev) => ({
      ...prev,
      [invoiceId]: bounded,
    }));
  };

  const clearAllocation = (invoiceId: string) => {
    setAllocatedByInvoice((prev) => {
      const next = { ...prev };
      delete next[invoiceId];
      return next;
    });
  };

  const submit = async () => {
    const allocations = customerRows
      .map((row) => ({
        invoiceId: row.invoiceId,
        amount: round2(allocatedByInvoice[row.invoiceId] ?? 0),
      }))
      .filter((allocation) => allocation.amount > 0);

    if (selectedUnappliedPayment) {
      if (selectedTotal <= 0) {
        setError(t("paymentWorkbenchSelectInvoices"));
        return;
      }
      if (
        selectedTotal > round2(selectedUnappliedPayment.unappliedAmount + 0.01)
      ) {
        setError(t("paymentWorkbenchAllocationAboveUnapplied"));
        return;
      }

      setSaving(true);
      setError("");
      setMessage("");
      try {
        await api.post(
          `/finance/payments/${selectedUnappliedPayment.paymentId}/allocations`,
          { allocations },
        );
        setMessage(t("paymentWorkbenchApplied"));
        await load();
      } catch (reason: unknown) {
        setError(readApiError(reason, t("paymentWorkbenchApplyFailed")));
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!selectedPartnerId || paymentAmount <= 0) {
      setError(t("paymentWorkbenchPaymentRequired"));
      return;
    }

    if (paymentAmount < selectedTotal) {
      setError(t("paymentWorkbenchPaymentBelowAllocation"));
      return;
    }

    if (allocations.length === 0 && selectedTotal > 0) {
      setError(t("paymentWorkbenchSelectInvoices"));
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api.post("/finance/payments", {
        partnerId: selectedPartnerId,
        amount: paymentAmount,
        method: paymentMethod,
        allocations,
      });
      setMessage(t("paymentWorkbenchSaved"));
      await load();
    } catch (reason: unknown) {
      setError(readApiError(reason, t("paymentWorkbenchSaveFailed")));
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
        <h3 className="text-sm font-semibold text-slate-900">
          {t("paymentWorkbenchTitle")}
        </h3>
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

      <div className="grid gap-3 lg:grid-cols-[2fr_1fr_1fr_1fr_auto_auto]">
        <select
          value={selectedPartnerId}
          onChange={(event) => {
            setSelectedPartnerId(event.target.value);
            setSelectedUnappliedPaymentId("");
            setAllocatedByInvoice({});
            setPaymentAmount(0);
          }}
          className="rounded-md border border-slate-300 p-2 text-sm"
        >
          <option value="">{t("paymentWorkbenchSelectCustomer")}</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name} / {money(customer.openAmount)}
            </option>
          ))}
        </select>
        <select
          value={selectedUnappliedPaymentId}
          onChange={(event) => {
            const paymentId = event.target.value;
            setSelectedUnappliedPaymentId(paymentId);
            setAllocatedByInvoice({});
            const selected = customerUnappliedRows.find(
              (payment) => payment.paymentId === paymentId,
            );
            setPaymentAmount(selected?.unappliedAmount ?? 0);
          }}
          className="rounded-md border border-slate-300 p-2 text-sm"
        >
          <option value="">{t("paymentWorkbenchNewReceipt")}</option>
          {customerUnappliedRows.map((payment) => (
            <option key={payment.paymentId} value={payment.paymentId}>
              {payment.method} / {money(payment.unappliedAmount)}
            </option>
          ))}
        </select>
        <select
          value={paymentMethod}
          onChange={(event) => setPaymentMethod(event.target.value)}
          disabled={!!selectedUnappliedPayment}
          className="rounded-md border border-slate-300 p-2 text-sm"
        >
          <option value="BANK_TRANSFER">{t("financePaymentBank")}</option>
          <option value="ALIPAY">{t("financePaymentAlipay")}</option>
          <option value="WECHAT">{t("financePaymentWechat")}</option>
          <option value="CASH">{t("financePaymentCash")}</option>
        </select>
        <input
          type="number"
          min="0"
          step="0.01"
          value={paymentAmount}
          onChange={(event) =>
            setPaymentAmount(round2(Number(event.target.value)))
          }
          disabled={!!selectedUnappliedPayment}
          className="rounded-md border border-slate-300 p-2 text-sm"
          placeholder={t("paymentWorkbenchPaymentAmount")}
        />
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {t("paymentWorkbenchAllocated")}: {money(selectedTotal)}
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {t("paymentWorkbenchUnapplied")}:{" "}
          {money(
            selectedUnappliedPayment
              ? Math.max(
                  selectedUnappliedPayment.unappliedAmount - selectedTotal,
                  0,
                )
              : unappliedAmount,
          )}
        </div>
        <button
          type="button"
          onClick={autoAllocateAll}
          disabled={!selectedPartnerId || customerRows.length === 0 || saving}
          className="inline-flex items-center justify-center rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <Wand2 className="mr-2 h-4 w-4" />
          {t("paymentWorkbenchAuto")}
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!selectedPartnerId || paymentAmount <= 0 || saving}
          className="inline-flex items-center justify-center rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Banknote className="mr-2 h-4 w-4" />
          )}
          {selectedUnappliedPayment
            ? t("paymentWorkbenchApply")
            : t("paymentWorkbenchSubmit")}
        </button>
      </div>

      {unappliedRows.length > 0 ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="text-xs font-medium text-amber-900">
            {t("paymentWorkbenchUnappliedPool")}
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {unappliedRows.slice(0, 6).map((payment) => (
              <div
                key={payment.paymentId}
                className="rounded-md border border-amber-100 bg-white px-3 py-2 text-xs text-slate-700"
              >
                <div className="font-medium text-slate-900">
                  {payment.partnerName}
                </div>
                <div>
                  {payment.method} / {payment.paymentDate.slice(0, 10)}
                </div>
                <div>
                  {t("paymentWorkbenchUnapplied")}:{" "}
                  {money(payment.unappliedAmount)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">
                {t("paymentWorkbenchInvoice")}
              </th>
              <th className="px-3 py-2 text-right">
                {t("paymentWorkbenchOpen")}
              </th>
              <th className="px-3 py-2 text-right">
                {t("paymentWorkbenchDaysOverdue")}
              </th>
              <th className="px-3 py-2 text-right">
                {t("paymentWorkbenchAllocation")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {customerRows.map((row) => {
              const allocated = allocatedByInvoice[row.invoiceId] ?? 0;
              return (
                <tr key={row.invoiceId} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">
                      {row.invoiceNo}
                    </div>
                    <div className="text-xs text-slate-500">
                      {row.orderNo ?? "-"} / {row.dueDate?.slice(0, 10) ?? "-"}
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
                            row.invoiceId,
                            Number(event.target.value),
                          )
                        }
                        className="w-32 rounded-md border border-slate-300 p-2 text-right text-sm"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          allocated > 0
                            ? clearAllocation(row.invoiceId)
                            : setAllocation(row.invoiceId, row.openAmount)
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
            {selectedPartnerId && customerRows.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-8 text-center text-sm text-slate-500"
                >
                  {t("paymentWorkbenchNoInvoices")}
                </td>
              </tr>
            ) : null}
            {!selectedPartnerId ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-8 text-center text-sm text-slate-500"
                >
                  {t("paymentWorkbenchNoCustomer")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
