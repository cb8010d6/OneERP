"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, RotateCcw, Truck } from "lucide-react";
import toast from "react-hot-toast";
import api from "@/lib/api";
import { Button } from "@/components/ui/Button";

type LocationOption = {
  id: string;
  name: string;
  warehouse?: { name?: string };
};

type SalesOrderOption = {
  id: string;
  orderNo: string;
  status: string;
  partner?: { name?: string };
};

type PurchaseOrderOption = {
  id: string;
  purchaseNo: string;
  status: string;
  supplier?: { name?: string };
};

type InventoryReturnDocument = {
  id: string;
  returnNo: string;
  returnType: "SALES" | "PURCHASE" | string;
  sourceDocumentNo: string;
  status: string;
  postedAt: string;
  lines: Array<{
    id: string;
    materialId: string;
    quantity: string | number;
  }>;
  creditNote?: {
    id: string;
    creditNo: string;
    postingStatus: string;
  } | null;
  supplierCreditNote?: {
    id: string;
    creditNo: string;
    postingStatus: string;
  } | null;
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

function locationLabel(location: LocationOption) {
  return location.warehouse?.name
    ? `${location.warehouse.name} / ${location.name}`
    : location.name;
}

export function ReturnsWorkbench({ onPosted }: { onPosted?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState<"sale" | "purchase" | null>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrderOption[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderOption[]>(
    [],
  );
  const [returnDocuments, setReturnDocuments] = useState<
    InventoryReturnDocument[]
  >([]);
  const [saleOrderId, setSaleOrderId] = useState("");
  const [purchaseNo, setPurchaseNo] = useState("");
  const [destLocationId, setDestLocationId] = useState("");
  const [sourceLocationId, setSourceLocationId] = useState("");
  const [saleNote, setSaleNote] = useState("");
  const [purchaseNote, setPurchaseNote] = useState("");

  const returnableSalesOrders = useMemo(
    () =>
      salesOrders.filter((order) =>
        ["SHIPPED", "COMPLETED", "PARTIAL_SHIPPED"].includes(order.status),
      ),
    [salesOrders],
  );
  const returnablePurchaseOrders = useMemo(
    () =>
      purchaseOrders.filter((order) =>
        ["PARTIAL_RECEIVED", "RECEIVED"].includes(order.status),
      ),
    [purchaseOrders],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [
        locationResponse,
        salesResponse,
        purchaseResponse,
        returnsResponse,
      ] = await Promise.all([
        api.get<LocationOption[]>("/inventory/locations"),
        api.get<{ data: SalesOrderOption[] }>("/orders", {
          params: { page: 1, limit: 100 },
        }),
        api.get<PurchaseOrderOption[]>("/purchase/orders"),
        api.get<InventoryReturnDocument[]>("/inventory/returns"),
      ]);
      setLocations(locationResponse.data);
      setSalesOrders(salesResponse.data.data ?? []);
      setPurchaseOrders(purchaseResponse.data);
      setReturnDocuments(returnsResponse.data);
      setSaleOrderId(
        (previous) => previous || salesResponse.data.data?.[0]?.id || "",
      );
      setPurchaseNo(
        (previous) => previous || purchaseResponse.data[0]?.purchaseNo || "",
      );
      setDestLocationId(
        (previous) => previous || locationResponse.data[0]?.id || "",
      );
      setSourceLocationId(
        (previous) => previous || locationResponse.data[0]?.id || "",
      );
    } catch (reason: unknown) {
      toast.error(readApiError(reason, "退货基础数据加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const postSalesReturn = async () => {
    if (!saleOrderId) return;
    setPosting("sale");
    try {
      await api.post(`/inventory/posting/sale-order/${saleOrderId}/reverse`, {
        destLocationId: destLocationId || undefined,
        note: saleNote || undefined,
      });
      toast.success("销售退货回库已过账");
      setSaleNote("");
      await load();
      onPosted?.();
    } catch (reason: unknown) {
      toast.error(readApiError(reason, "销售退货回库失败"));
    } finally {
      setPosting(null);
    }
  };

  const postPurchaseReturn = async () => {
    if (!purchaseNo) return;
    setPosting("purchase");
    try {
      await api.post(`/inventory/posting/purchase/${purchaseNo}/reverse`, {
        sourceLocationId: sourceLocationId || undefined,
        note: purchaseNote || undefined,
      });
      toast.success("采购退货出库已过账");
      setPurchaseNote("");
      await load();
      onPosted?.();
    } catch (reason: unknown) {
      toast.error(readApiError(reason, "采购退货出库失败"));
    } finally {
      setPosting(null);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <RotateCcw className="h-4 w-4 text-slate-600" />
            退货过账
          </h2>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={load}
          disabled={loading}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="rounded-lg border border-slate-100 p-3">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
            <Truck className="h-4 w-4" />
            销售退货回库
          </div>
          <div className="grid gap-2 md:grid-cols-[2fr_1fr]">
            <select
              className="erp-input"
              value={saleOrderId}
              onChange={(event) => setSaleOrderId(event.target.value)}
            >
              <option value="">选择销售订单</option>
              {returnableSalesOrders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.orderNo} / {order.partner?.name ?? "-"} /{" "}
                  {order.status}
                </option>
              ))}
            </select>
            <select
              className="erp-input"
              value={destLocationId}
              onChange={(event) => setDestLocationId(event.target.value)}
            >
              <option value="">原发货库位</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {locationLabel(location)}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
            <input
              className="erp-input"
              value={saleNote}
              onChange={(event) => setSaleNote(event.target.value)}
              placeholder="退货备注"
            />
            <Button
              onClick={postSalesReturn}
              disabled={!saleOrderId || posting === "sale"}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              回库过账
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-slate-100 p-3">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase text-slate-500">
            <Truck className="h-4 w-4" />
            采购退货出库
          </div>
          <div className="grid gap-2 md:grid-cols-[2fr_1fr]">
            <select
              className="erp-input"
              value={purchaseNo}
              onChange={(event) => setPurchaseNo(event.target.value)}
            >
              <option value="">选择采购单</option>
              {returnablePurchaseOrders.map((order) => (
                <option key={order.id} value={order.purchaseNo}>
                  {order.purchaseNo} / {order.supplier?.name ?? "-"} /{" "}
                  {order.status}
                </option>
              ))}
            </select>
            <select
              className="erp-input"
              value={sourceLocationId}
              onChange={(event) => setSourceLocationId(event.target.value)}
            >
              <option value="">原收货库位</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {locationLabel(location)}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
            <input
              className="erp-input"
              value={purchaseNote}
              onChange={(event) => setPurchaseNote(event.target.value)}
              placeholder="退货备注"
            />
            <Button
              onClick={postPurchaseReturn}
              disabled={!purchaseNo || posting === "purchase"}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              出库过账
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto border-t border-slate-100 pt-4">
        <div className="mb-2 text-xs font-semibold uppercase text-slate-500">
          最近退货单据
        </div>
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">退货单</th>
              <th className="px-2 py-2">类型</th>
              <th className="px-2 py-2">来源单据</th>
              <th className="px-2 py-2">红字凭证</th>
              <th className="px-2 py-2">供应商扣款</th>
              <th className="px-2 py-2">明细数</th>
              <th className="px-2 py-2">数量合计</th>
              <th className="px-2 py-2">状态</th>
              <th className="px-2 py-2">过账时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {returnDocuments.slice(0, 8).map((document) => {
              const totalQty = document.lines.reduce(
                (sum, line) => sum + Number(line.quantity ?? 0),
                0,
              );
              return (
                <tr key={document.id}>
                  <td className="px-2 py-2 font-medium text-slate-900">
                    {document.returnNo}
                  </td>
                  <td className="px-2 py-2 text-slate-600">
                    {document.returnType === "SALES" ? "销售退货" : "采购退货"}
                  </td>
                  <td className="px-2 py-2 text-slate-600">
                    {document.sourceDocumentNo}
                  </td>
                  <td className="px-2 py-2 text-slate-600">
                    {document.creditNote?.creditNo ?? "-"}
                  </td>
                  <td className="px-2 py-2 text-slate-600">
                    {document.supplierCreditNote?.creditNo ?? "-"}
                  </td>
                  <td className="px-2 py-2 text-slate-600">
                    {document.lines.length}
                  </td>
                  <td className="px-2 py-2 text-slate-700">{totalQty}</td>
                  <td className="px-2 py-2 text-slate-600">
                    {document.status}
                  </td>
                  <td className="px-2 py-2 text-slate-600">
                    {document.postedAt.slice(0, 10)}
                  </td>
                </tr>
              );
            })}
            {returnDocuments.length === 0 ? (
              <tr>
                <td
                  className="px-2 py-6 text-center text-slate-500"
                  colSpan={9}
                >
                  暂无退货过账单据。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
