"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FilePlus2,
  Loader2,
  PackageCheck,
  ReceiptText,
  RefreshCw,
} from "lucide-react";
import api from "@/lib/api";
import { fetchResourceList } from "@/lib/dynamic-resource";
import { useI18n } from "@/lib/i18n";
import { useAuthStore } from "@/store/authStore";

type OptionRecord = {
  id: string;
  name?: string;
  sku?: string;
  code?: string;
  type?: string;
  unitPrice?: string | number;
};

type PurchaseOrderLine = {
  id: string;
  materialId: string;
  quantity: string | number;
  receivedQty: string | number;
  unitPrice: string | number;
  material?: { name?: string; sku?: string };
};

type PurchaseOrder = {
  id: string;
  purchaseNo: string;
  status: string;
  supplier?: { id?: string; name?: string };
  items: PurchaseOrderLine[];
  invoices?: Array<{
    id: string;
    invoiceNo: string;
    amount: string | number;
    status: string;
    postingStatus: string;
    supplierCreditNotes?: Array<{
      amount: string | number;
      postingStatus: string;
    }>;
    supplierPaymentAllocations?: Array<{
      amount: string | number;
      supplierPayment?: { postingStatus: string };
    }>;
  }>;
  purchaseMatch?: PurchaseMatchSummary;
};

type PurchaseMatchStatus =
  | "NO_INVOICE"
  | "PARTIAL_RECEIPT"
  | "OVER_RECEIPT"
  | "PRICE_VARIANCE"
  | "MATCHED";

type PurchaseMatchSummary = {
  status: PurchaseMatchStatus;
  isPostable: boolean;
  orderedAmount: number;
  receivedAmount: number;
  invoicedAmount: number;
  amountVariance: number;
  reasons: string[];
};

type InventoryReturnDocument = {
  id: string;
  returnNo: string;
  returnType: string;
  sourceDocumentNo: string;
  status: string;
  postedAt: string;
  supplierCreditNote?: {
    id: string;
    creditNo: string;
    postingStatus: string;
  } | null;
};

type SupplierCreditNote = {
  id: string;
  creditNo: string;
  amount: string | number;
  reason?: string | null;
  postingStatus: string;
  creditDate: string;
  purchaseInvoice?: {
    invoiceNo?: string;
    purchaseOrder?: { purchaseNo?: string };
  };
  supplier?: { name?: string };
  inventoryReturnDocument?: { returnNo?: string } | null;
};

type SupplierPayment = {
  id: string;
  paymentNo: string;
  amount: string | number;
  method: string;
  postingStatus: string;
  paymentDate: string;
  supplier?: { name?: string };
  allocations?: Array<{
    amount: string | number;
    purchaseInvoice?: {
      invoiceNo?: string;
      purchaseOrder?: { purchaseNo?: string };
    };
  }>;
};

type PurchaseOrderFormLine = {
  materialId: string;
  quantity: number;
  unitPrice: number;
  note: string;
};

type ReceiveLine = {
  purchaseOrderLineId: string;
  quantity: number;
  destLocationId: string;
  batchNo: string;
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

function numeric(value: string | number | undefined) {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? next : 0;
}

function purchaseInvoiceOpenAmount(
  invoice: NonNullable<PurchaseOrder["invoices"]>[number],
) {
  const credited = (invoice.supplierCreditNotes ?? [])
    .filter((creditNote) => creditNote.postingStatus === "POSTED")
    .reduce((sum, creditNote) => sum + numeric(creditNote.amount), 0);
  const paid = (invoice.supplierPaymentAllocations ?? [])
    .filter(
      (allocation) =>
        !allocation.supplierPayment ||
        allocation.supplierPayment.postingStatus === "POSTED",
    )
    .reduce((sum, allocation) => sum + numeric(allocation.amount), 0);
  return Math.max(0, numeric(invoice.amount) - credited - paid);
}

function purchaseMatchStatusLabel(
  status: PurchaseMatchStatus | undefined,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (status === "MATCHED") return t("purchaseMatchMatched");
  if (status === "PRICE_VARIANCE") return t("purchaseMatchPriceVariance");
  if (status === "PARTIAL_RECEIPT") return t("purchaseMatchPartialReceipt");
  if (status === "OVER_RECEIPT") return t("purchaseMatchOverReceipt");
  return t("purchaseMatchNoInvoice");
}

export function PurchaseWorkbench() {
  const { t } = useI18n();
  const { currentCompanyId } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<
    | "order"
    | "receive"
    | "invoice"
    | "invoicePost"
    | "supplierCredit"
    | "supplierPayment"
    | null
  >(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [suppliers, setSuppliers] = useState<OptionRecord[]>([]);
  const [materials, setMaterials] = useState<OptionRecord[]>([]);
  const [locations, setLocations] = useState<OptionRecord[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [returnDocuments, setReturnDocuments] = useState<
    InventoryReturnDocument[]
  >([]);
  const [supplierCreditNotes, setSupplierCreditNotes] = useState<
    SupplierCreditNote[]
  >([]);
  const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>(
    [],
  );
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [orderForm, setOrderForm] = useState({
    supplierId: "",
    expectedDate: "",
    notes: "",
    items: [
      { materialId: "", quantity: 1, unitPrice: 0, note: "" },
    ] as PurchaseOrderFormLine[],
  });
  const [receiveLines, setReceiveLines] = useState<ReceiveLine[]>([]);
  const [receiveNote, setReceiveNote] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [supplierCreditAmount, setSupplierCreditAmount] = useState("");
  const [supplierCreditReason, setSupplierCreditReason] = useState("");
  const [selectedReturnDocumentId, setSelectedReturnDocumentId] = useState("");
  const [supplierPaymentAmount, setSupplierPaymentAmount] = useState("");
  const [supplierPaymentMethod, setSupplierPaymentMethod] =
    useState("BANK_TRANSFER");
  const [supplierPaymentNote, setSupplierPaymentNote] = useState("");

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId),
    [orders, selectedOrderId],
  );
  const selectedPurchaseInvoice = selectedOrder?.invoices?.[0];
  const selectedPurchaseMatch = selectedOrder?.purchaseMatch;
  const supplierCreditOpenAmount = selectedPurchaseInvoice
    ? purchaseInvoiceOpenAmount(selectedPurchaseInvoice)
    : 0;
  const availablePurchaseReturns = useMemo(
    () =>
      returnDocuments
        .filter((document) => {
          if (!selectedOrder) return false;
          if (
            document.returnType !== "PURCHASE" ||
            document.status !== "POSTED" ||
            document.supplierCreditNote
          ) {
            return false;
          }
          return document.sourceDocumentNo === selectedOrder.purchaseNo;
        })
        .sort((a, b) => b.postedAt.localeCompare(a.postedAt)),
    [returnDocuments, selectedOrder],
  );

  const load = useCallback(async () => {
    if (!currentCompanyId) return;
    setLoading(true);
    setError("");
    try {
      const [
        supplierResp,
        materialResp,
        locationResp,
        orderResp,
        returnResp,
        supplierCreditResp,
        supplierPaymentResp,
      ] = await Promise.all([
        fetchResourceList("partner", { page: 1, limit: 100 }),
        fetchResourceList("material", { page: 1, limit: 100 }),
        fetchResourceList("stockLocation", { page: 1, limit: 100 }),
        api.get<PurchaseOrder[]>("/purchase/orders"),
        api.get<InventoryReturnDocument[]>("/inventory/returns"),
        api.get<SupplierCreditNote[]>("/purchase/supplier-credit-notes"),
        api.get<SupplierPayment[]>("/purchase/supplier-payments"),
      ]);
      const nextSuppliers = (supplierResp.data as OptionRecord[]).filter(
        (item) => ["SUPPLIER", "BOTH"].includes(String(item.type ?? "")),
      );
      setSuppliers(nextSuppliers);
      setMaterials(materialResp.data as OptionRecord[]);
      setLocations(locationResp.data as OptionRecord[]);
      setOrders(orderResp.data);
      setReturnDocuments(returnResp.data);
      setSupplierCreditNotes(supplierCreditResp.data);
      setSupplierPayments(supplierPaymentResp.data);
      setOrderForm((prev) => ({
        ...prev,
        supplierId: prev.supplierId || nextSuppliers[0]?.id || "",
      }));
      setSelectedOrderId((prev) => prev || orderResp.data[0]?.id || "");
    } catch (reason: unknown) {
      setError(readApiError(reason, t("purchaseLoadFailed")));
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedOrder) {
      setReceiveLines([]);
      return;
    }
    setReceiveLines(
      selectedOrder.items
        .map((line) => ({
          purchaseOrderLineId: line.id,
          quantity: Math.max(
            numeric(line.quantity) - numeric(line.receivedQty),
            0,
          ),
          destLocationId: locations[0]?.id ?? "",
          batchNo: "",
        }))
        .filter((line) => line.quantity > 0),
    );
  }, [locations, selectedOrder]);

  const createOrder = async () => {
    setSaving("order");
    setError("");
    setMessage("");
    try {
      await api.post("/purchase/orders", {
        supplierId: orderForm.supplierId,
        expectedDate: orderForm.expectedDate || undefined,
        notes: orderForm.notes || undefined,
        items: orderForm.items.map((line) => ({
          materialId: line.materialId,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          note: line.note || undefined,
        })),
      });
      setMessage(t("purchaseOrderCreated"));
      setOrderForm((prev) => ({
        ...prev,
        notes: "",
        expectedDate: "",
        items: [{ materialId: "", quantity: 1, unitPrice: 0, note: "" }],
      }));
      await load();
    } catch (reason: unknown) {
      setError(readApiError(reason, t("purchaseOrderCreateFailed")));
    } finally {
      setSaving(null);
    }
  };

  const receiveOrder = async () => {
    if (!selectedOrder) return;
    setSaving("receive");
    setError("");
    setMessage("");
    try {
      await api.post(`/purchase/orders/${selectedOrder.id}/receive`, {
        note: receiveNote || undefined,
        lines: receiveLines
          .filter((line) => line.quantity > 0)
          .map((line) => ({
            purchaseOrderLineId: line.purchaseOrderLineId,
            quantity: Number(line.quantity),
            destLocationId: line.destLocationId,
            batchNo: line.batchNo || undefined,
          })),
      });
      setMessage(t("purchaseReceived"));
      setReceiveNote("");
      await load();
    } catch (reason: unknown) {
      setError(readApiError(reason, t("purchaseReceiveFailed")));
    } finally {
      setSaving(null);
    }
  };

  const createInvoice = async () => {
    if (!selectedOrder) return;
    setSaving("invoice");
    setError("");
    setMessage("");
    try {
      await api.post(`/purchase/orders/${selectedOrder.id}/invoice`, {
        invoiceNo: invoiceNo || undefined,
        dueDate: dueDate || undefined,
      });
      setMessage(t("purchaseInvoiceCreated"));
      setInvoiceNo("");
      setDueDate("");
      await load();
    } catch (reason: unknown) {
      setError(readApiError(reason, t("purchaseInvoiceCreateFailed")));
    } finally {
      setSaving(null);
    }
  };

  const postPurchaseInvoice = async () => {
    if (!selectedPurchaseInvoice) return;
    setSaving("invoicePost");
    setError("");
    setMessage("");
    try {
      await api.post(`/purchase/invoices/${selectedPurchaseInvoice.id}/post`);
      setMessage(t("purchaseInvoicePosted"));
      await load();
    } catch (reason: unknown) {
      setError(readApiError(reason, t("purchaseInvoicePostFailed")));
    } finally {
      setSaving(null);
    }
  };

  const createSupplierCreditNote = async () => {
    if (!selectedPurchaseInvoice) return;
    const amount = Number(supplierCreditAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t("purchaseSupplierCreditAmountInvalid"));
      return;
    }
    setSaving("supplierCredit");
    setError("");
    setMessage("");
    try {
      await api.post(
        `/purchase/invoices/${selectedPurchaseInvoice.id}/supplier-credit-notes`,
        {
          amount,
          inventoryReturnDocumentId: selectedReturnDocumentId || undefined,
          reason: supplierCreditReason || undefined,
        },
      );
      setSupplierCreditAmount("");
      setSupplierCreditReason("");
      setSelectedReturnDocumentId("");
      setMessage(t("purchaseSupplierCreditCreated"));
      await load();
    } catch (reason: unknown) {
      setError(readApiError(reason, t("purchaseSupplierCreditCreateFailed")));
    } finally {
      setSaving(null);
    }
  };

  const postSupplierCreditNote = async (id: string) => {
    setSaving("supplierCredit");
    setError("");
    setMessage("");
    try {
      await api.post(`/purchase/supplier-credit-notes/${id}/post`);
      setMessage(t("purchaseSupplierCreditPosted"));
      await load();
    } catch (reason: unknown) {
      setError(readApiError(reason, t("purchaseSupplierCreditPostFailed")));
    } finally {
      setSaving(null);
    }
  };

  const createSupplierPayment = async () => {
    if (!selectedOrder?.supplier?.id || !selectedPurchaseInvoice) return;
    const amount = Number(supplierPaymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t("purchaseSupplierPaymentAmountInvalid"));
      return;
    }
    setSaving("supplierPayment");
    setError("");
    setMessage("");
    try {
      await api.post("/purchase/supplier-payments", {
        supplierId: selectedOrder.supplier.id,
        amount,
        method: supplierPaymentMethod,
        note: supplierPaymentNote || undefined,
        allocations: [
          {
            purchaseInvoiceId: selectedPurchaseInvoice.id,
            amount,
          },
        ],
      });
      setSupplierPaymentAmount("");
      setSupplierPaymentNote("");
      setMessage(t("purchaseSupplierPaymentCreated"));
      await load();
    } catch (reason: unknown) {
      setError(readApiError(reason, t("purchaseSupplierPaymentCreateFailed")));
    } finally {
      setSaving(null);
    }
  };

  const postSupplierPayment = async (id: string) => {
    setSaving("supplierPayment");
    setError("");
    setMessage("");
    try {
      await api.post(`/purchase/supplier-payments/${id}/post`);
      setMessage(t("purchaseSupplierPaymentPosted"));
      await load();
    } catch (reason: unknown) {
      setError(readApiError(reason, t("purchaseSupplierPaymentPostFailed")));
    } finally {
      setSaving(null);
    }
  };

  const updateOrderLine = (
    index: number,
    patch: Partial<PurchaseOrderFormLine>,
  ) => {
    setOrderForm((prev) => ({
      ...prev,
      items: prev.items.map((line, current) =>
        current === index ? { ...line, ...patch } : line,
      ),
    }));
  };

  const updateReceiveLine = (index: number, patch: Partial<ReceiveLine>) => {
    setReceiveLines((prev) =>
      prev.map((line, current) =>
        current === index ? { ...line, ...patch } : line,
      ),
    );
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
    <div className="space-y-4">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-5">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center text-sm font-semibold text-slate-900">
              <FilePlus2 className="mr-2 h-4 w-4 text-blue-600" />
              {t("purchaseCreateOrder")}
            </h3>
            <button
              type="button"
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
              onClick={() => void load()}
              title={t("commonRefresh")}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-600">
              {t("purchaseSupplier")}
              <select
                value={orderForm.supplierId}
                onChange={(event) =>
                  setOrderForm((prev) => ({
                    ...prev,
                    supplierId: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
              >
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600">
              {t("purchaseExpectedDate")}
              <input
                type="date"
                value={orderForm.expectedDate}
                onChange={(event) =>
                  setOrderForm((prev) => ({
                    ...prev,
                    expectedDate: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
              />
            </label>
            {orderForm.items.map((line, index) => (
              <div
                key={index}
                className="rounded-md border border-slate-200 p-3"
              >
                <div className="grid gap-2 md:grid-cols-3">
                  <select
                    value={line.materialId}
                    onChange={(event) => {
                      const material = materials.find(
                        (item) => item.id === event.target.value,
                      );
                      updateOrderLine(index, {
                        materialId: event.target.value,
                        unitPrice: numeric(material?.unitPrice),
                      });
                    }}
                    className="rounded-md border border-slate-300 p-2 text-sm"
                  >
                    <option value="">{t("purchaseMaterial")}</option>
                    {materials.map((material) => (
                      <option key={material.id} value={material.id}>
                        {material.sku ? `${material.sku} - ` : ""}
                        {material.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    value={line.quantity}
                    onChange={(event) =>
                      updateOrderLine(index, {
                        quantity: Number(event.target.value),
                      })
                    }
                    className="rounded-md border border-slate-300 p-2 text-sm"
                    placeholder={t("purchaseQuantity")}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.unitPrice}
                    onChange={(event) =>
                      updateOrderLine(index, {
                        unitPrice: Number(event.target.value),
                      })
                    }
                    className="rounded-md border border-slate-300 p-2 text-sm"
                    placeholder={t("purchaseUnitPrice")}
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setOrderForm((prev) => ({
                  ...prev,
                  items: [
                    ...prev.items,
                    { materialId: "", quantity: 1, unitPrice: 0, note: "" },
                  ],
                }))
              }
              className="text-sm font-medium text-blue-700 hover:text-blue-900"
            >
              {t("purchaseAddLine")}
            </button>
            <textarea
              value={orderForm.notes}
              onChange={(event) =>
                setOrderForm((prev) => ({ ...prev, notes: event.target.value }))
              }
              className="w-full rounded-md border border-slate-300 p-2 text-sm"
              placeholder={t("purchaseNotes")}
            />
            <button
              type="button"
              onClick={createOrder}
              disabled={saving !== null}
              className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving === "order" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FilePlus2 className="mr-2 h-4 w-4" />
              )}
              {t("purchaseCreateOrder")}
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-4 flex items-center text-sm font-semibold text-slate-900">
            <PackageCheck className="mr-2 h-4 w-4 text-emerald-600" />
            {t("purchaseReceive")}
          </h3>
          <div className="space-y-3">
            <OrderSelector
              orders={orders}
              selectedOrderId={selectedOrderId}
              onChange={setSelectedOrderId}
            />
            {receiveLines.length === 0 ? (
              <p className="text-sm text-slate-500">
                {t("purchaseNoReceivableLines")}
              </p>
            ) : (
              receiveLines.map((line, index) => {
                const sourceLine = selectedOrder?.items.find(
                  (item) => item.id === line.purchaseOrderLineId,
                );
                return (
                  <div
                    key={line.purchaseOrderLineId}
                    className="space-y-2 rounded-md border border-slate-200 p-3"
                  >
                    <div className="text-xs font-medium text-slate-700">
                      {sourceLine?.material?.sku
                        ? `${sourceLine.material.sku} - `
                        : ""}
                      {sourceLine?.material?.name ?? line.purchaseOrderLineId}
                    </div>
                    <div className="grid gap-2 md:grid-cols-3">
                      <input
                        type="number"
                        min="0.0001"
                        step="0.0001"
                        value={line.quantity}
                        onChange={(event) =>
                          updateReceiveLine(index, {
                            quantity: Number(event.target.value),
                          })
                        }
                        className="rounded-md border border-slate-300 p-2 text-sm"
                      />
                      <select
                        value={line.destLocationId}
                        onChange={(event) =>
                          updateReceiveLine(index, {
                            destLocationId: event.target.value,
                          })
                        }
                        className="rounded-md border border-slate-300 p-2 text-sm"
                      >
                        <option value="">{t("purchaseDestLocation")}</option>
                        {locations.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.code ? `${location.code} - ` : ""}
                            {location.name}
                          </option>
                        ))}
                      </select>
                      <input
                        value={line.batchNo}
                        onChange={(event) =>
                          updateReceiveLine(index, {
                            batchNo: event.target.value,
                          })
                        }
                        className="rounded-md border border-slate-300 p-2 text-sm"
                        placeholder={t("purchaseBatchNo")}
                      />
                    </div>
                  </div>
                );
              })
            )}
            <textarea
              value={receiveNote}
              onChange={(event) => setReceiveNote(event.target.value)}
              className="w-full rounded-md border border-slate-300 p-2 text-sm"
              placeholder={t("purchaseReceiveNote")}
            />
            <button
              type="button"
              onClick={receiveOrder}
              disabled={
                !selectedOrder || receiveLines.length === 0 || saving !== null
              }
              className="inline-flex w-full items-center justify-center rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving === "receive" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PackageCheck className="mr-2 h-4 w-4" />
              )}
              {t("purchasePostReceipt")}
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-4 flex items-center text-sm font-semibold text-slate-900">
            <ReceiptText className="mr-2 h-4 w-4 text-violet-600" />
            {t("purchaseCreateInvoice")}
          </h3>
          <div className="space-y-3">
            <OrderSelector
              orders={orders}
              selectedOrderId={selectedOrderId}
              onChange={setSelectedOrderId}
            />
            <input
              value={invoiceNo}
              onChange={(event) => setInvoiceNo(event.target.value)}
              className="w-full rounded-md border border-slate-300 p-2 text-sm"
              placeholder={t("purchaseInvoiceNoOptional")}
            />
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="w-full rounded-md border border-slate-300 p-2 text-sm"
            />
            {selectedPurchaseMatch ? (
              <div
                className={`rounded-md border px-3 py-2 text-xs ${
                  selectedPurchaseMatch.status === "MATCHED"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : selectedPurchaseMatch.status === "PRICE_VARIANCE"
                      ? "border-sky-200 bg-sky-50 text-sky-800"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{t("purchaseMatchTitle")}</span>
                  <span>
                    {purchaseMatchStatusLabel(selectedPurchaseMatch.status, t)}
                  </span>
                </div>
                <div className="mt-1 grid gap-1 sm:grid-cols-3">
                  <span>
                    {t("purchaseMatchReceivedAmount")}:{" "}
                    {selectedPurchaseMatch.receivedAmount.toFixed(2)}
                  </span>
                  <span>
                    {t("purchaseMatchInvoicedAmount")}:{" "}
                    {selectedPurchaseMatch.invoicedAmount.toFixed(2)}
                  </span>
                  <span>
                    {t("purchaseMatchVariance")}:{" "}
                    {selectedPurchaseMatch.amountVariance.toFixed(2)}
                  </span>
                </div>
                {selectedPurchaseMatch.reasons.length > 0 ? (
                  <div className="mt-1">
                    {selectedPurchaseMatch.reasons.join(" / ")}
                  </div>
                ) : null}
              </div>
            ) : null}
            {selectedPurchaseInvoice ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <div className="flex items-center justify-between gap-3">
                  <span>{selectedPurchaseInvoice.invoiceNo}</span>
                  <span>
                    {selectedPurchaseInvoice.status} /{" "}
                    {selectedPurchaseInvoice.postingStatus}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <span>
                    {t("amount")}:{" "}
                    {numeric(selectedPurchaseInvoice.amount).toFixed(2)}
                  </span>
                  <span>
                    {t("purchaseSupplierCreditOpenPayable")}:{" "}
                    {supplierCreditOpenAmount.toFixed(2)}
                  </span>
                </div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={createInvoice}
              disabled={!selectedOrder || saving !== null}
              className="inline-flex w-full items-center justify-center rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
            >
              {saving === "invoice" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ReceiptText className="mr-2 h-4 w-4" />
              )}
              {t("purchaseCreateInvoice")}
            </button>
            {selectedPurchaseInvoice &&
            selectedPurchaseInvoice.postingStatus !== "POSTED" ? (
              <button
                type="button"
                onClick={postPurchaseInvoice}
                disabled={
                  !selectedPurchaseInvoice ||
                  selectedPurchaseMatch?.isPostable !== true ||
                  saving !== null
                }
                className="inline-flex w-full items-center justify-center rounded-md border border-violet-200 bg-white px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-60"
              >
                {saving === "invoicePost" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ReceiptText className="mr-2 h-4 w-4" />
                )}
                {t("purchasePostInvoice")}
              </button>
            ) : null}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-4 flex items-center text-sm font-semibold text-slate-900">
            <ReceiptText className="mr-2 h-4 w-4 text-amber-600" />
            {t("purchaseSupplierCreditTitle")}
          </h3>
          <div className="space-y-3">
            <OrderSelector
              orders={orders}
              selectedOrderId={selectedOrderId}
              onChange={(next) => {
                setSelectedOrderId(next);
                setSelectedReturnDocumentId("");
              }}
            />
            <select
              value={selectedReturnDocumentId}
              onChange={(event) =>
                setSelectedReturnDocumentId(event.target.value)
              }
              className="w-full rounded-md border border-slate-300 p-2 text-sm"
              disabled={!selectedPurchaseInvoice}
            >
              <option value="">
                {t("purchaseSupplierCreditReturnOptional")}
              </option>
              {availablePurchaseReturns.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.returnNo} / {document.sourceDocumentNo}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={supplierCreditAmount}
              onChange={(event) => setSupplierCreditAmount(event.target.value)}
              className="w-full rounded-md border border-slate-300 p-2 text-sm"
              placeholder={t("purchaseSupplierCreditAmount")}
            />
            <input
              value={supplierCreditReason}
              onChange={(event) => setSupplierCreditReason(event.target.value)}
              className="w-full rounded-md border border-slate-300 p-2 text-sm"
              placeholder={t("purchaseSupplierCreditReason")}
            />
            {selectedPurchaseInvoice ? (
              <p className="text-xs text-slate-500">
                {t("purchaseSupplierCreditOpenPayable")}:{" "}
                {supplierCreditOpenAmount.toFixed(2)}
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                {t("purchaseSupplierCreditNoInvoice")}
              </p>
            )}
            <button
              type="button"
              onClick={createSupplierCreditNote}
              disabled={!selectedPurchaseInvoice || saving !== null}
              className="inline-flex w-full items-center justify-center rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {saving === "supplierCredit" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ReceiptText className="mr-2 h-4 w-4" />
              )}
              {t("purchaseSupplierCreditCreate")}
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-4 flex items-center text-sm font-semibold text-slate-900">
            <ReceiptText className="mr-2 h-4 w-4 text-sky-600" />
            {t("purchaseSupplierPaymentTitle")}
          </h3>
          <div className="space-y-3">
            <OrderSelector
              orders={orders}
              selectedOrderId={selectedOrderId}
              onChange={setSelectedOrderId}
            />
            <select
              value={supplierPaymentMethod}
              onChange={(event) => setSupplierPaymentMethod(event.target.value)}
              className="w-full rounded-md border border-slate-300 p-2 text-sm"
            >
              <option value="BANK_TRANSFER">{t("financePaymentBank")}</option>
              <option value="CASH">{t("financePaymentCash")}</option>
              <option value="ALIPAY">{t("financePaymentAlipay")}</option>
              <option value="WECHAT">{t("financePaymentWechat")}</option>
            </select>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={supplierPaymentAmount}
              onChange={(event) => setSupplierPaymentAmount(event.target.value)}
              className="w-full rounded-md border border-slate-300 p-2 text-sm"
              placeholder={t("purchaseSupplierPaymentAmount")}
            />
            <input
              value={supplierPaymentNote}
              onChange={(event) => setSupplierPaymentNote(event.target.value)}
              className="w-full rounded-md border border-slate-300 p-2 text-sm"
              placeholder={t("purchaseSupplierPaymentNote")}
            />
            {selectedPurchaseInvoice ? (
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>
                  {t("purchaseSupplierCreditOpenPayable")}:{" "}
                  {supplierCreditOpenAmount.toFixed(2)}
                </span>
                <button
                  type="button"
                  className="font-medium text-blue-700 hover:text-blue-900"
                  onClick={() =>
                    setSupplierPaymentAmount(
                      String(Number(supplierCreditOpenAmount.toFixed(2))),
                    )
                  }
                >
                  {t("paymentWorkbenchUseOpen")}
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                {t("purchaseSupplierCreditNoInvoice")}
              </p>
            )}
            <button
              type="button"
              onClick={createSupplierPayment}
              disabled={!selectedPurchaseInvoice || saving !== null}
              className="inline-flex w-full items-center justify-center rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
            >
              {saving === "supplierPayment" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ReceiptText className="mr-2 h-4 w-4" />
              )}
              {t("purchaseSupplierPaymentCreate")}
            </button>
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">
          {t("purchaseSupplierCreditRecent")}
        </h3>
        <div className="space-y-3 md:hidden">
          {supplierCreditNotes.slice(0, 8).map((creditNote) => (
            <div
              key={creditNote.id}
              className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">
                    {creditNote.creditNo}
                  </p>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {creditNote.supplier?.name ?? "-"}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {creditNote.postingStatus}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs">
                <div>
                  <p className="text-slate-500">{t("purchaseInvoiceTab")}</p>
                  <p className="mt-1 truncate font-medium text-slate-800">
                    {creditNote.purchaseInvoice?.invoiceNo ?? "-"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-slate-500">{t("amount")}</p>
                  <p className="mt-1 font-semibold text-slate-900">
                    {numeric(creditNote.amount).toFixed(2)}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-slate-500">
                    {t("creditNoteReturnDocument")}
                  </p>
                  <p className="mt-1 truncate font-medium text-slate-800">
                    {creditNote.inventoryReturnDocument?.returnNo ?? "-"}
                  </p>
                </div>
              </div>
              {creditNote.postingStatus !== "POSTED" ? (
                <button
                  type="button"
                  onClick={() => void postSupplierCreditNote(creditNote.id)}
                  disabled={saving !== null}
                  className="mt-3 w-full rounded-md border border-slate-200 px-2 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {t("post")}
                </button>
              ) : null}
            </div>
          ))}
          {supplierCreditNotes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
              {t("purchaseSupplierCreditEmpty")}
            </div>
          ) : null}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="px-2 py-2">{t("purchaseSupplierCreditNo")}</th>
                <th className="px-2 py-2">{t("purchaseInvoiceTab")}</th>
                <th className="px-2 py-2">{t("purchaseSupplier")}</th>
                <th className="px-2 py-2">{t("creditNoteReturnDocument")}</th>
                <th className="px-2 py-2">{t("amount")}</th>
                <th className="px-2 py-2">{t("status")}</th>
                <th className="px-2 py-2 text-right">{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {supplierCreditNotes.slice(0, 8).map((creditNote) => (
                <tr key={creditNote.id}>
                  <td className="px-2 py-2 font-medium text-slate-900">
                    {creditNote.creditNo}
                  </td>
                  <td className="px-2 py-2 text-slate-600">
                    {creditNote.purchaseInvoice?.invoiceNo ?? "-"}
                  </td>
                  <td className="px-2 py-2 text-slate-600">
                    {creditNote.supplier?.name ?? "-"}
                  </td>
                  <td className="px-2 py-2 text-slate-600">
                    {creditNote.inventoryReturnDocument?.returnNo ?? "-"}
                  </td>
                  <td className="px-2 py-2 text-slate-700">
                    {numeric(creditNote.amount).toFixed(2)}
                  </td>
                  <td className="px-2 py-2 text-slate-600">
                    {creditNote.postingStatus}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {creditNote.postingStatus !== "POSTED" ? (
                      <button
                        type="button"
                        onClick={() =>
                          void postSupplierCreditNote(creditNote.id)
                        }
                        disabled={saving !== null}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {t("post")}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {supplierCreditNotes.length === 0 ? (
                <tr>
                  <td
                    className="px-2 py-6 text-center text-slate-500"
                    colSpan={7}
                  >
                    {t("purchaseSupplierCreditEmpty")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">
          {t("purchaseSupplierPaymentRecent")}
        </h3>
        <div className="space-y-3 md:hidden">
          {supplierPayments.slice(0, 8).map((payment) => {
            const invoiceNos = (payment.allocations ?? [])
              .map((allocation) => allocation.purchaseInvoice?.invoiceNo)
              .filter(Boolean)
              .join(", ");
            return (
              <div
                key={payment.id}
                className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">
                      {payment.paymentNo}
                    </p>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {payment.supplier?.name ?? "-"}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {payment.postingStatus}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs">
                  <div>
                    <p className="text-slate-500">{t("purchaseInvoiceTab")}</p>
                    <p className="mt-1 truncate font-medium text-slate-800">
                      {invoiceNos || "-"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-500">{t("amount")}</p>
                    <p className="mt-1 font-semibold text-slate-900">
                      {numeric(payment.amount).toFixed(2)}
                    </p>
                  </div>
                </div>
                {payment.postingStatus !== "POSTED" ? (
                  <button
                    type="button"
                    onClick={() => void postSupplierPayment(payment.id)}
                    disabled={saving !== null}
                    className="mt-3 w-full rounded-md border border-slate-200 px-2 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {t("post")}
                  </button>
                ) : null}
              </div>
            );
          })}
          {supplierPayments.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
              {t("purchaseSupplierPaymentEmpty")}
            </div>
          ) : null}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="px-2 py-2">{t("purchaseSupplierPaymentNo")}</th>
                <th className="px-2 py-2">{t("purchaseSupplier")}</th>
                <th className="px-2 py-2">{t("purchaseInvoiceTab")}</th>
                <th className="px-2 py-2">{t("amount")}</th>
                <th className="px-2 py-2">{t("status")}</th>
                <th className="px-2 py-2 text-right">{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {supplierPayments.slice(0, 8).map((payment) => (
                <tr key={payment.id}>
                  <td className="px-2 py-2 font-medium text-slate-900">
                    {payment.paymentNo}
                  </td>
                  <td className="px-2 py-2 text-slate-600">
                    {payment.supplier?.name ?? "-"}
                  </td>
                  <td className="px-2 py-2 text-slate-600">
                    {(payment.allocations ?? [])
                      .map(
                        (allocation) => allocation.purchaseInvoice?.invoiceNo,
                      )
                      .filter(Boolean)
                      .join(", ") || "-"}
                  </td>
                  <td className="px-2 py-2 text-slate-700">
                    {numeric(payment.amount).toFixed(2)}
                  </td>
                  <td className="px-2 py-2 text-slate-600">
                    {payment.postingStatus}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {payment.postingStatus !== "POSTED" ? (
                      <button
                        type="button"
                        onClick={() => void postSupplierPayment(payment.id)}
                        disabled={saving !== null}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {t("post")}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {supplierPayments.length === 0 ? (
                <tr>
                  <td
                    className="px-2 py-6 text-center text-slate-500"
                    colSpan={6}
                  >
                    {t("purchaseSupplierPaymentEmpty")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function OrderSelector({
  orders,
  selectedOrderId,
  onChange,
}: {
  orders: PurchaseOrder[];
  selectedOrderId: string;
  onChange: (next: string) => void;
}) {
  return (
    <select
      value={selectedOrderId}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-md border border-slate-300 p-2 text-sm"
    >
      {orders.map((order) => (
        <option key={order.id} value={order.id}>
          {order.purchaseNo} / {order.supplier?.name ?? ""} / {order.status}
        </option>
      ))}
    </select>
  );
}
