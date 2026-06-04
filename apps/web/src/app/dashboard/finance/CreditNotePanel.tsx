"use client";

import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Send, RefreshCw } from "lucide-react";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";

type MoneyValue = number | string;

interface InvoiceOption {
  id: string;
  invoiceNo: string;
  amount: MoneyValue;
  status: string;
  postingStatus: string;
  order?: {
    id?: string;
    orderNo?: string;
    partner?: { name?: string };
  };
  paymentAllocations?: Array<{ amount: MoneyValue }>;
  creditNotes?: Array<{ amount: MoneyValue; postingStatus: string }>;
}

interface CreditNote {
  id: string;
  creditNo: string;
  amount: MoneyValue;
  receivableAppliedAmount: MoneyValue;
  refundLiabilityAmount: MoneyValue;
  reason?: string | null;
  status: string;
  postingStatus: string;
  creditDate: string;
  invoice?: { invoiceNo?: string };
  partner?: { name?: string };
  inventoryReturnDocument?: {
    id: string;
    returnNo: string;
    returnType: string;
    sourceDocumentNo: string;
  } | null;
  refunds?: Array<{ amount: MoneyValue; postingStatus: string }>;
}

interface CustomerRefund {
  id: string;
  refundNo: string;
  amount: MoneyValue;
  method: string;
  postingStatus: string;
  refundDate: string;
  creditNote?: { creditNo?: string };
  partner?: { name?: string };
}

interface InventoryReturnDocument {
  id: string;
  returnNo: string;
  returnType: string;
  sourceDocumentId?: string | null;
  sourceDocumentNo: string;
  status: string;
  postedAt: string;
  creditNote?: {
    id: string;
    creditNo: string;
    postingStatus: string;
  } | null;
}

interface Paginated<T> {
  data: T[];
  total: number;
}

function money(value: MoneyValue | undefined) {
  const next = Number(value ?? 0);
  return next.toLocaleString(undefined, {
    style: "currency",
    currency: "CNY",
  });
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function invoiceOpenAmount(invoice: InvoiceOption) {
  const amount = Number(invoice.amount ?? 0);
  const paid = (invoice.paymentAllocations ?? []).reduce(
    (sum, allocation) => sum + Number(allocation.amount ?? 0),
    0,
  );
  const credited = (invoice.creditNotes ?? [])
    .filter((creditNote) => creditNote.postingStatus === "POSTED")
    .reduce((sum, creditNote) => sum + Number(creditNote.amount ?? 0), 0);
  return round2(amount - paid - credited);
}

function refundableBalance(creditNote: CreditNote) {
  const refunded = (creditNote.refunds ?? [])
    .filter((refund) => refund.postingStatus === "POSTED")
    .reduce((sum, refund) => sum + Number(refund.amount ?? 0), 0);
  return round2(Number(creditNote.refundLiabilityAmount ?? 0) - refunded);
}

function dateOnly(value: string) {
  return value.slice(0, 10);
}

export function CreditNotePanel() {
  const { t } = useI18n();
  const currentCompanyId = useAuthStore((state) => state.currentCompanyId);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [refunds, setRefunds] = useState<CustomerRefund[]>([]);
  const [returnDocuments, setReturnDocuments] = useState<
    InventoryReturnDocument[]
  >([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [selectedReturnDocumentId, setSelectedReturnDocumentId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState("BANK_TRANSFER");
  const [loading, setLoading] = useState(false);
  const [postingId, setPostingId] = useState<string | null>(null);
  const [refundPostingId, setRefundPostingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const openInvoices = useMemo(
    () =>
      invoices
        .filter(
          (invoice) =>
            invoice.postingStatus === "POSTED" &&
            invoiceOpenAmount(invoice) > 0,
        )
        .sort((a, b) => invoiceOpenAmount(b) - invoiceOpenAmount(a)),
    [invoices],
  );
  const selectedInvoice = openInvoices.find(
    (invoice) => invoice.id === selectedInvoiceId,
  );
  const selectedOpenAmount = selectedInvoice
    ? invoiceOpenAmount(selectedInvoice)
    : 0;
  const availableReturnDocuments = useMemo(
    () =>
      returnDocuments
        .filter((document) => {
          if (!selectedInvoice) return false;
          if (document.returnType !== "SALES" || document.status !== "POSTED") {
            return false;
          }
          if (document.creditNote) return false;
          return (
            document.sourceDocumentId === selectedInvoice.order?.id ||
            document.sourceDocumentNo === selectedInvoice.order?.orderNo
          );
        })
        .sort((a, b) => b.postedAt.localeCompare(a.postedAt)),
    [returnDocuments, selectedInvoice],
  );

  const load = async () => {
    if (!currentCompanyId) return;
    setLoading(true);
    try {
      const [
        invoiceResponse,
        creditNoteResponse,
        refundResponse,
        returnResponse,
      ] = await Promise.all([
        api.get<Paginated<InvoiceOption>>("/finance/invoices", {
          params: { page: 1, limit: 100 },
        }),
        api.get<Paginated<CreditNote>>("/finance/credit-notes", {
          params: { page: 1, limit: 20 },
        }),
        api.get<Paginated<CustomerRefund>>("/finance/customer-refunds", {
          params: { page: 1, limit: 20 },
        }),
        api.get<InventoryReturnDocument[]>("/inventory/returns"),
      ]);
      setInvoices(invoiceResponse.data.data);
      setCreditNotes(creditNoteResponse.data.data);
      setRefunds(refundResponse.data.data);
      setReturnDocuments(returnResponse.data);
      setSelectedInvoiceId((previous) =>
        invoiceResponse.data.data.some((invoice) => invoice.id === previous)
          ? previous
          : "",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompanyId]);

  const createCreditNote = async () => {
    if (!selectedInvoice || !amount) return;
    const numericAmount = round2(Number(amount));
    if (
      numericAmount <= 0 ||
      numericAmount > round2(selectedOpenAmount + 0.01)
    ) {
      setMessage(t("creditNoteAmountInvalid"));
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      await api.post("/finance/credit-notes", {
        invoiceId: selectedInvoice.id,
        amount: numericAmount,
        inventoryReturnDocumentId: selectedReturnDocumentId || undefined,
        reason: reason.trim() || undefined,
      });
      setAmount("");
      setReason("");
      setSelectedReturnDocumentId("");
      setMessage(t("creditNoteCreated"));
      await load();
    } catch (error) {
      const response = error as { response?: { data?: { message?: string } } };
      setMessage(
        response.response?.data?.message ?? t("creditNoteCreateFailed"),
      );
    } finally {
      setLoading(false);
    }
  };

  const postCreditNote = async (creditNoteId: string) => {
    setPostingId(creditNoteId);
    setMessage("");
    try {
      await api.post(`/finance/credit-notes/${creditNoteId}/post`);
      setMessage(t("creditNotePosted"));
      await load();
    } catch (error) {
      const response = error as { response?: { data?: { message?: string } } };
      setMessage(response.response?.data?.message ?? t("creditNotePostFailed"));
    } finally {
      setPostingId(null);
    }
  };

  const createRefund = async (creditNote: CreditNote) => {
    const balance = refundableBalance(creditNote);
    if (balance <= 0) return;
    setPostingId(creditNote.id);
    setMessage("");
    try {
      await api.post("/finance/customer-refunds", {
        creditNoteId: creditNote.id,
        amount: balance,
        method: refundMethod,
      });
      setMessage(t("customerRefundCreated"));
      await load();
    } catch (error) {
      const response = error as { response?: { data?: { message?: string } } };
      setMessage(
        response.response?.data?.message ?? t("customerRefundCreateFailed"),
      );
    } finally {
      setPostingId(null);
    }
  };

  const postRefund = async (refundId: string) => {
    setRefundPostingId(refundId);
    setMessage("");
    try {
      await api.post(`/finance/customer-refunds/${refundId}/post`);
      setMessage(t("customerRefundPosted"));
      await load();
    } catch (error) {
      const response = error as { response?: { data?: { message?: string } } };
      setMessage(
        response.response?.data?.message ?? t("customerRefundPostFailed"),
      );
    } finally {
      setRefundPostingId(null);
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            {t("creditNoteTitle")}
          </h2>
          <p className="text-xs text-slate-500">{t("creditNoteSubtitle")}</p>
        </div>
        <Button
          variant="secondary"
          onClick={load}
          disabled={loading}
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          {t("refresh")}
        </Button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[2fr_1.4fr_1fr_1.5fr_auto]">
        <select
          value={selectedInvoiceId}
          onChange={(event) => {
            const invoice = openInvoices.find(
              (item) => item.id === event.target.value,
            );
            setSelectedInvoiceId(event.target.value);
            setSelectedReturnDocumentId("");
            setAmount(invoice ? String(invoiceOpenAmount(invoice)) : "");
          }}
          className="erp-input"
        >
          <option value="">{t("creditNoteSelectInvoice")}</option>
          {openInvoices.map((invoice) => (
            <option key={invoice.id} value={invoice.id}>
              {invoice.invoiceNo} / {invoice.order?.partner?.name ?? "-"} /{" "}
              {money(invoiceOpenAmount(invoice))}
            </option>
          ))}
        </select>
        <select
          value={selectedReturnDocumentId}
          onChange={(event) => setSelectedReturnDocumentId(event.target.value)}
          className="erp-input"
          disabled={!selectedInvoiceId}
        >
          <option value="">{t("creditNoteSelectReturn")}</option>
          {availableReturnDocuments.map((document) => (
            <option key={document.id} value={document.id}>
              {document.returnNo} / {document.sourceDocumentNo}
            </option>
          ))}
        </select>
        <input
          className="erp-input"
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder={t("creditNoteAmount")}
        />
        <input
          className="erp-input"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t("creditNoteReason")}
        />
        <Button
          onClick={createCreditNote}
          disabled={!selectedInvoiceId || loading}
          className="gap-2"
        >
          <RotateCcw className="h-4 w-4" />
          {t("creditNoteCreate")}
        </Button>
      </div>

      {selectedInvoice ? (
        <div className="mt-3 text-xs text-slate-500">
          {t("creditNoteOpenAmount")}: {money(selectedOpenAmount)}
        </div>
      ) : null}
      {message ? (
        <div className="mt-3 text-sm text-slate-600">{message}</div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs font-medium text-slate-500">
          {t("customerRefundMethod")}
        </span>
        <select
          className="erp-input w-auto"
          value={refundMethod}
          onChange={(event) => setRefundMethod(event.target.value)}
        >
          <option value="BANK_TRANSFER">{t("financePaymentBank")}</option>
          <option value="CASH">{t("financePaymentCash")}</option>
          <option value="ALIPAY">{t("financePaymentAlipay")}</option>
          <option value="WECHAT">{t("financePaymentWechat")}</option>
        </select>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">{t("creditNoteNo")}</th>
              <th className="px-2 py-2">{t("financeInvoice")}</th>
              <th className="px-2 py-2">{t("creditNoteReturnDocument")}</th>
              <th className="px-2 py-2">{t("customer")}</th>
              <th className="px-2 py-2">{t("amount")}</th>
              <th className="px-2 py-2">{t("creditNoteReceivableApplied")}</th>
              <th className="px-2 py-2">{t("customerRefundBalance")}</th>
              <th className="px-2 py-2">{t("status")}</th>
              <th className="px-2 py-2">{t("date")}</th>
              <th className="px-2 py-2 text-right">{t("actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {creditNotes.map((creditNote) => (
              <tr key={creditNote.id}>
                <td className="px-2 py-2 font-medium text-slate-900">
                  {creditNote.creditNo}
                </td>
                <td className="px-2 py-2 text-slate-600">
                  {creditNote.invoice?.invoiceNo ?? "-"}
                </td>
                <td className="px-2 py-2 text-slate-600">
                  {creditNote.inventoryReturnDocument?.returnNo ?? "-"}
                </td>
                <td className="px-2 py-2 text-slate-600">
                  {creditNote.partner?.name ?? "-"}
                </td>
                <td className="px-2 py-2 text-slate-700">
                  {money(creditNote.amount)}
                </td>
                <td className="px-2 py-2 text-slate-700">
                  {money(creditNote.receivableAppliedAmount)}
                </td>
                <td className="px-2 py-2 text-slate-700">
                  {money(refundableBalance(creditNote))}
                </td>
                <td className="px-2 py-2 text-slate-600">
                  {creditNote.postingStatus}
                </td>
                <td className="px-2 py-2 text-slate-600">
                  {dateOnly(creditNote.creditDate)}
                </td>
                <td className="px-2 py-2 text-right">
                  {creditNote.postingStatus !== "POSTED" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => postCreditNote(creditNote.id)}
                      disabled={postingId === creditNote.id}
                      className="gap-2"
                    >
                      <Send className="h-4 w-4" />
                      {t("post")}
                    </Button>
                  ) : refundableBalance(creditNote) > 0 ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => createRefund(creditNote)}
                      disabled={postingId === creditNote.id}
                      className="gap-2"
                    >
                      <Send className="h-4 w-4" />
                      {t("customerRefundCreate")}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
            {creditNotes.length === 0 ? (
              <tr>
                <td
                  className="px-2 py-6 text-center text-slate-500"
                  colSpan={10}
                >
                  {t("creditNoteEmpty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-5 overflow-x-auto border-t border-slate-100 pt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">
          {t("customerRefundTitle")}
        </h3>
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">{t("customerRefundNo")}</th>
              <th className="px-2 py-2">{t("creditNoteNo")}</th>
              <th className="px-2 py-2">{t("customer")}</th>
              <th className="px-2 py-2">{t("amount")}</th>
              <th className="px-2 py-2">{t("status")}</th>
              <th className="px-2 py-2">{t("date")}</th>
              <th className="px-2 py-2 text-right">{t("actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {refunds.map((refund) => (
              <tr key={refund.id}>
                <td className="px-2 py-2 font-medium text-slate-900">
                  {refund.refundNo}
                </td>
                <td className="px-2 py-2 text-slate-600">
                  {refund.creditNote?.creditNo ?? "-"}
                </td>
                <td className="px-2 py-2 text-slate-600">
                  {refund.partner?.name ?? "-"}
                </td>
                <td className="px-2 py-2 text-slate-700">
                  {money(refund.amount)}
                </td>
                <td className="px-2 py-2 text-slate-600">
                  {refund.postingStatus}
                </td>
                <td className="px-2 py-2 text-slate-600">
                  {dateOnly(refund.refundDate)}
                </td>
                <td className="px-2 py-2 text-right">
                  {refund.postingStatus !== "POSTED" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => postRefund(refund.id)}
                      disabled={refundPostingId === refund.id}
                      className="gap-2"
                    >
                      <Send className="h-4 w-4" />
                      {t("post")}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
            {refunds.length === 0 ? (
              <tr>
                <td
                  className="px-2 py-6 text-center text-slate-500"
                  colSpan={7}
                >
                  {t("customerRefundEmpty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
