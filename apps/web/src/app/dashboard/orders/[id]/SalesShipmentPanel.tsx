"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Truck } from "lucide-react";
import toast from "react-hot-toast";
import api from "@/lib/api";

type OrderItem = {
  id: string;
  productId: string;
  quantity: number;
};

type LocationOption = {
  id: string;
  name: string;
  warehouse?: { name?: string };
};

type ShipmentResult = {
  status: string;
  postingStatus: string;
  message: string;
  postedLines: Array<{
    productId: string;
    requestedQuantity: number;
    quantity: number;
    allocations: Array<{ batchNo: string; quantity: number }>;
  }>;
  skippedLines: Array<{
    productId: string;
    requestedQuantity: number;
    reason: string;
  }>;
};

function readApiError(reason: unknown) {
  if (reason && typeof reason === "object" && "response" in reason) {
    const response = (reason as { response?: { data?: { message?: unknown } } })
      .response;
    if (typeof response?.data?.message === "string") {
      return response.data.message;
    }
  }
  return "销售发货失败";
}

export function SalesShipmentPanel({
  orderId,
  orderNo,
  items,
  onPosted,
}: {
  orderId: string;
  orderNo: string;
  items: OrderItem[];
  onPosted?: (result: ShipmentResult) => void;
}) {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [sourceLocationId, setSourceLocationId] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [note, setNote] = useState("");
  const [allowPartial, setAllowPartial] = useState(false);
  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState<ShipmentResult | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(items.map((item) => [item.id, Number(item.quantity)])),
  );

  useEffect(() => {
    const loadLocations = async () => {
      try {
        const response = await api.get<LocationOption[]>(
          "/inventory/locations",
        );
        setLocations(response.data);
        setSourceLocationId((current) => current || response.data[0]?.id || "");
      } catch (reason) {
        toast.error(readApiError(reason));
      }
    };
    void loadLocations();
  }, []);

  const requestedTotal = useMemo(
    () =>
      items.reduce((sum, item) => sum + Number(quantities[item.id] ?? 0), 0),
    [items, quantities],
  );

  const submit = async () => {
    const shipmentItems = items
      .map((item) => ({
        productId: item.productId,
        shipQuantity: Number(quantities[item.id] ?? 0),
      }))
      .filter((item) => item.shipQuantity > 0);
    if (!shipmentItems.length) {
      toast.error("至少填写一条大于 0 的发货数量");
      return;
    }

    setPosting(true);
    setResult(null);
    try {
      const response = await api.post<ShipmentResult>(
        `/inventory/posting/sale-order/${orderId}/ship`,
        {
          sourceLocationId: sourceLocationId || undefined,
          batchNo: batchNo.trim() || undefined,
          note: note.trim() || undefined,
          allowPartial,
          items: shipmentItems,
        },
      );
      setResult(response.data);
      toast.success(
        allowPartial
          ? `部分发货完成：过账 ${response.data.postedLines.length} 行，跳过 ${response.data.skippedLines.length} 行`
          : "整单发货已原子过账",
      );
      onPosted?.(response.data);
    } catch (reason) {
      toast.error(readApiError(reason));
    } finally {
      setPosting(false);
    }
  };

  return (
    <section className="rounded-xl border border-indigo-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <Truck className="h-5 w-5 text-indigo-600" />
            销售发货过账
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            订单 {orderNo} · 本次申请 {requestedTotal} 件
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            allowPartial
              ? "bg-amber-100 text-amber-800"
              : "bg-emerald-100 text-emerald-800"
          }`}
        >
          {allowPartial ? "允许部分成功" : "整单原子过账"}
        </span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <label className="text-sm font-medium text-gray-700">
          来源库位
          <select
            aria-label="来源库位"
            value={sourceLocationId}
            onChange={(event) => setSourceLocationId(event.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
          >
            <option value="">自动选择可用库位</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.warehouse?.name
                  ? `${location.warehouse.name} / ${location.name}`
                  : location.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-gray-700">
          批次号（可选）
          <input
            aria-label="批次号"
            value={batchNo}
            onChange={(event) => setBatchNo(event.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
            placeholder="不填则按可用批次分配"
          />
        </label>
        <label className="text-sm font-medium text-gray-700">
          发货备注（可选）
          <input
            aria-label="发货备注"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
          />
        </label>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-gray-100">
        {items.map((item) => (
          <div
            key={item.id}
            className="grid grid-cols-[1fr_140px] items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-0"
          >
            <div>
              <p className="text-sm font-medium text-gray-900">
                产品 {item.productId}
              </p>
              <p className="text-xs text-gray-500">订单数量 {item.quantity}</p>
            </div>
            <label className="text-xs font-medium text-gray-600">
              本次发货
              <input
                aria-label={`产品 ${item.productId} 发货数量`}
                type="number"
                min="0"
                step="1"
                value={quantities[item.id] ?? 0}
                onChange={(event) =>
                  setQuantities((current) => ({
                    ...current,
                    [item.id]: Number(event.target.value),
                  }))
                }
                className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-right text-sm"
              />
            </label>
          </div>
        ))}
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <input
          aria-label="允许部分发货"
          type="checkbox"
          checked={allowPartial}
          onChange={(event) => setAllowPartial(event.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="block text-sm font-semibold text-amber-900">
            允许部分发货
          </span>
          <span className="block text-xs text-amber-700">
            开启后库存不足的行会被跳过；关闭时任一行失败都会整单回滚。
          </span>
        </span>
      </label>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={posting}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {posting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Truck className="h-4 w-4" />
          )}
          {allowPartial ? "执行部分发货" : "执行整单原子发货"}
        </button>
      </div>

      {result && (
        <div className="mt-4 space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
            <CheckCircle2 className="h-4 w-4" />
            {result.message}
          </div>
          <p className="text-xs text-emerald-800">
            已过账 {result.postedLines.length} 行 · 跳过{" "}
            {result.skippedLines.length} 行 · 订单状态 {result.status}
          </p>
          {result.skippedLines.length > 0 && (
            <div className="space-y-1">
              {result.skippedLines.map((line) => (
                <div
                  key={`${line.productId}-${line.reason}`}
                  className="flex items-start gap-2 rounded bg-amber-100 px-3 py-2 text-xs text-amber-900"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  产品 {line.productId}：{line.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
