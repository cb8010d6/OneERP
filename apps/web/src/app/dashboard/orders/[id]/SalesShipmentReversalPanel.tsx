"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import toast from "react-hot-toast";
import api from "@/lib/api";

type LocationOption = {
  id: string;
  name: string;
  warehouse?: { name?: string };
};

type ReturnDocument = {
  id: string;
  returnNo: string;
  returnType: string;
  sourceDocumentId?: string | null;
  sourceDocumentNo: string;
  status: string;
  postedAt: string;
  lines: Array<{
    id: string;
    quantity: string | number;
  }>;
};

type ReversalResult = {
  message: string;
  reversedLines: Array<{
    materialId: string;
    quantity: number;
    transactionId: string;
  }>;
  returnDocument?: ReturnDocument | null;
};

function readApiError(reason: unknown) {
  if (reason && typeof reason === "object" && "response" in reason) {
    const response = (reason as { response?: { data?: { message?: unknown } } })
      .response;
    if (typeof response?.data?.message === "string") {
      return response.data.message;
    }
  }
  return "销售发货冲销失败";
}

function locationLabel(location: LocationOption) {
  return location.warehouse?.name
    ? `${location.warehouse.name} / ${location.name}`
    : location.name;
}

export function SalesShipmentReversalPanel({
  orderId,
  orderNo,
  onReversed,
}: {
  orderId: string;
  orderNo: string;
  onReversed?: () => void;
}) {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [returnDocuments, setReturnDocuments] = useState<ReturnDocument[]>([]);
  const [destLocationId, setDestLocationId] = useState("");
  const [note, setNote] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState<ReversalResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [locationResponse, returnsResponse] = await Promise.all([
        api.get<LocationOption[]>("/inventory/locations"),
        api.get<ReturnDocument[]>("/inventory/returns"),
      ]);
      setLocations(locationResponse.data);
      setDestLocationId(
        (current) => current || locationResponse.data[0]?.id || "",
      );
      setReturnDocuments(
        returnsResponse.data.filter(
          (document) =>
            document.returnType === "SALES" &&
            (document.sourceDocumentId === orderId ||
              document.sourceDocumentNo === orderNo),
        ),
      );
    } catch (reason) {
      toast.error(readApiError(reason));
    } finally {
      setLoading(false);
    }
  }, [orderId, orderNo]);

  useEffect(() => {
    void load();
  }, [load]);

  const reversedTotal = useMemo(
    () =>
      result?.reversedLines.reduce(
        (sum, line) => sum + Number(line.quantity ?? 0),
        0,
      ) ?? 0,
    [result],
  );

  const reverse = async () => {
    if (!acknowledged) return;
    setPosting(true);
    setResult(null);
    try {
      const response = await api.post<ReversalResult>(
        `/inventory/posting/sale-order/${orderId}/reverse`,
        {
          destLocationId: destLocationId || undefined,
          note: note.trim() || undefined,
        },
      );
      setResult(response.data);
      setAcknowledged(false);
      setNote("");
      toast.success(response.data.message);
      await load();
      onReversed?.();
    } catch (reason) {
      toast.error(readApiError(reason));
    } finally {
      setPosting(false);
    }
  };

  return (
    <section className="rounded-xl border border-rose-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <RotateCcw className="h-5 w-5 text-rose-600" />
            发货冲销与回库
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            订单 {orderNo} · 生成不可删除的反向库存流水和销售退货单
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          刷新记录
        </button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="text-sm font-medium text-gray-700">
          回库目标库位
          <select
            aria-label="回库目标库位"
            value={destLocationId}
            onChange={(event) => setDestLocationId(event.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm"
          >
            <option value="">沿用原发货库位</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {locationLabel(location)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-gray-700">
          冲销原因
          <input
            aria-label="冲销原因"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
            placeholder="例如：错发、客户拒收、数量更正"
          />
        </label>
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
        <input
          aria-label="确认冲销影响"
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-rose-900">
            <ShieldCheck className="h-4 w-4" />
            我已确认本周期全部发货流水需要冲销
          </span>
          <span className="mt-1 block text-xs text-rose-700">
            操作会原子回库并把订单退回生产中；历史流水不会删除，可重新发货。
          </span>
        </span>
      </label>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => void reverse()}
          disabled={!acknowledged || posting}
          className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {posting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4" />
          )}
          确认冲销并回库
        </button>
      </div>

      {result && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="h-4 w-4" />
            {result.message}
          </div>
          <p className="mt-1 text-xs text-emerald-800">
            反向流水 {result.reversedLines.length} 条 · 回库数量 {reversedTotal} ·
            退货单 {result.returnDocument?.returnNo ?? "已存在"}
          </p>
        </div>
      )}

      <div className="mt-5 border-t border-gray-100 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          本订单冲销历史
        </h3>
        {returnDocuments.length > 0 ? (
          <div className="mt-2 space-y-2">
            {returnDocuments.map((document) => {
              const total = document.lines.reduce(
                (sum, line) => sum + Number(line.quantity ?? 0),
                0,
              );
              return (
                <div
                  key={document.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm"
                >
                  <span className="font-medium text-gray-900">
                    {document.returnNo}
                  </span>
                  <span className="text-gray-600">
                    {document.lines.length} 条 · {total} 件 · {document.status}
                  </span>
                  <span className="text-xs text-gray-500">
                    {document.postedAt.slice(0, 10)}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-500">暂无冲销记录。</p>
        )}
      </div>
    </section>
  );
}
