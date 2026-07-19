"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import api from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuthStore } from "@/store/authStore";

type Invoice = {
  id: string;
  invoiceNo: string;
  amount: string | number;
  status: string;
  postingStatus: string;
  payments?: Array<{ amount: string | number }>;
  paymentAllocations?: Array<{ amount: string | number }>;
  order?: { orderNo?: string };
};

function readApiError(reason: unknown, fallback: string) {
  if (reason && typeof reason === "object" && "response" in reason) {
    const response = (reason as { response?: { data?: { message?: unknown } } })
      .response;
    if (typeof response?.data?.message === "string")
      return response.data.message;
  }
  return fallback;
}

function money(value: string | number | undefined) {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? next : 0;
}

export function FinanceActionsPanel() {
  const { t } = useI18n();
  const { currentCompanyId } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<"post" | "pay" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("BANK_TRANSFER");

  const selectedInvoice = useMemo(
    () => invoices.find((invoice) => invoice.id === selectedInvoiceId),
    [invoices, selectedInvoiceId],
  );

  const remaining = useMemo(() => {
    if (!selectedInvoice) return 0;
    const allocations = selectedInvoice.paymentAllocations;
    const paid = allocations?.length
      ? allocations.reduce(
          (sum, allocation) => sum + money(allocation.amount),
          0,
        )
      : (selectedInvoice.payments?.reduce(
          (sum, payment) => sum + money(payment.amount),
          0,
        ) ?? 0);
    return Math.max(money(selectedInvoice.amount) - paid, 0);
  }, [selectedInvoice]);

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    setLoading(true);
    setError("");
    try {
      const response = await api.get<{ data: Invoice[] }>("/finance/invoices", {
        params: { page: 1, limit: 100 },
      });
      setInvoices(response.data.data);
      setSelectedInvoiceId((prev) => prev || response.data.data[0]?.id || "");
    } catch (reason: unknown) {
      setError(readApiError(reason, t("financeActionsLoadFailed")));
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPaymentAmount(remaining);
  }, [remaining]);

  const postInvoice = async () => {
    if (!selectedInvoice) return;
    setSaving("post");
    setError("");
    setMessage("");
    try {
      await api.post(`/finance/invoices/${selectedInvoice.id}/post`, {});
      setMessage(t("financeInvoicePosted"));
      await load();
    } catch (reason: unknown) {
      setError(readApiError(reason, t("financeInvoicePostFailed")));
    } finally {
      setSaving(null);
    }
  };

  const recordPayment = async () => {
    if (!selectedInvoice) return;
    setSaving("pay");
    setError("");
    setMessage("");
    try {
      await api.post(`/finance/invoices/${selectedInvoice.id}/payments`, {
        amount: Number(paymentAmount),
        method: paymentMethod,
      });
      setMessage(t("financePaymentRecorded"));
      await load();
    } catch (reason: unknown) {
      setError(readApiError(reason, t("financePaymentRecordFailed")));
    } finally {
      setSaving(null);
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
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">
          {t("financeActionsTitle")}
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
          value={selectedInvoiceId}
          onChange={(event) => setSelectedInvoiceId(event.target.value)}
          className="rounded-md border border-slate-300 p-2 text-sm"
        >
          {invoices.map((invoice) => (
            <option key={invoice.id} value={invoice.id}>
              {invoice.invoiceNo} / {invoice.order?.orderNo ?? ""} /{" "}
              {invoice.status} / {invoice.postingStatus}
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0"
          step="0.01"
          value={paymentAmount}
          onChange={(event) => setPaymentAmount(Number(event.target.value))}
          className="rounded-md border border-slate-300 p-2 text-sm"
          placeholder={t("financePaymentAmount")}
        />
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
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {t("financeRemaining")}: {remaining.toFixed(2)}
        </div>
        <button
          type="button"
          onClick={postInvoice}
          disabled={!selectedInvoice || saving !== null}
          className="inline-flex items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {saving === "post" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 h-4 w-4" />
          )}
          {t("financePostInvoice")}
        </button>
        <button
          type="button"
          onClick={recordPayment}
          disabled={!selectedInvoice || paymentAmount <= 0 || saving !== null}
          className="inline-flex items-center justify-center rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {saving === "pay" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Banknote className="mr-2 h-4 w-4" />
          )}
          {t("financeRecordPayment")}
        </button>
      </div>
    </section>
  );
}
