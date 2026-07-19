"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  Download,
  FilePlus2,
  FileText,
  History,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  UploadCloud,
  XCircle,
} from "lucide-react";
import toast from "react-hot-toast";
import { AsyncSelect } from "@/components/core/AsyncSelect";
import {
  Badge,
  Button,
  EmptyState,
  Sheet,
  Skeleton,
  StatCard,
} from "@/components/ui";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

interface EngineeringRevision {
  id: string;
  revisionNo: number;
  status: string;
  checksumSha256: string;
  notes?: string | null;
  reviewComment?: string | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  releasedAt?: string | null;
  createdAt: string;
  fileRecord: {
    id: string;
    fileName: string;
    objectKey: string;
  };
  creator: { id: string; name: string };
  reviewer?: { id: string; name: string } | null;
  approver?: { id: string; name: string } | null;
}

interface EngineeringDocument {
  id: string;
  documentNo: string;
  title: string;
  documentType: string;
  externalNo?: string | null;
  currentRevisionNo: number;
  currentReleasedRevisionId?: string | null;
  currentReleasedRevision?: EngineeringRevision | null;
  updatedAt: string;
  product?: { id: string; sku: string; name: string } | null;
  order?: { id: string; orderNo: string } | null;
  revisions: EngineeringRevision[];
}

type EcoDecision = "CONTINUE_OLD" | "SWITCH_NEW" | "SCRAP_REWORK";

interface EcoAffectedWorkOrder {
  id: string;
  workOrderNo: string;
  status: string;
  plannedQty: number;
  actualQty: number;
  product: { id: string; sku: string; name: string };
  order: { id: string; orderNo: string };
}

interface EcoPreview {
  sourceRevision: EngineeringRevision;
  targetRevision: EngineeringRevision;
  affectedWorkOrders: EcoAffectedWorkOrder[];
}

interface EngineeringChangeOrder {
  id: string;
  ecoNo: string;
  status: string;
  reason: string;
  impactAssessment: string;
  materialDisposition: string;
  engineeringDocument: { id: string; documentNo: string; title: string };
  sourceRevision: EngineeringRevision;
  targetRevision: EngineeringRevision;
  creator: { id: string; name: string };
  approver?: { id: string; name: string } | null;
  impacts: Array<{
    id: string;
    decision: EcoDecision;
    note?: string | null;
    workOrder: EcoAffectedWorkOrder;
  }>;
}

const statusLabels: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_REVIEW: "待校审",
  CHANGES_REQUESTED: "退回修改",
  PENDING_APPROVAL: "待批准",
  RELEASED: "已发布",
  OBSOLETE: "已作废",
};

const typeLabels: Record<string, string> = {
  DRAWING: "设计图纸",
  SPECIFICATION: "技术规范",
  PROCESS: "工艺文件",
};

const ecoDecisionLabels: Record<EcoDecision, string> = {
  CONTINUE_OLD: "偏差批准继续旧版",
  SWITCH_NEW: "切换新版",
  SCRAP_REWORK: "报废返工",
};

export function EngineeringDocumentWorkbench() {
  const currentCompanyId = useAuthStore((state) => state.currentCompanyId);
  const companies = useAuthStore((state) => state.companies);
  const permissions = useMemo(
    () =>
      companies.find((company) => company.id === currentCompanyId)
        ?.permissions ?? [],
    [companies, currentCompanyId],
  );
  const can = useCallback(
    (permission: string) =>
      permissions.includes("ALL") ||
      permissions.includes(permission) ||
      permissions.includes(`${permission.split(":")[0]}:*`),
    [permissions],
  );

  const [documents, setDocuments] = useState<EngineeringDocument[]>([]);
  const [changeOrders, setChangeOrders] = useState<EngineeringChangeOrder[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [revisionTarget, setRevisionTarget] =
    useState<EngineeringDocument | null>(null);
  const [reviewTarget, setReviewTarget] = useState<EngineeringRevision | null>(
    null,
  );
  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState("DRAWING");
  const [externalNo, setExternalNo] = useState("");
  const [productId, setProductId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [revisionFile, setRevisionFile] = useState<File | null>(null);
  const [revisionNotes, setRevisionNotes] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [ecoTarget, setEcoTarget] = useState<{
    document: EngineeringDocument;
    revision: EngineeringRevision;
  } | null>(null);
  const [ecoPreview, setEcoPreview] = useState<EcoPreview | null>(null);
  const [ecoReason, setEcoReason] = useState("");
  const [ecoImpactAssessment, setEcoImpactAssessment] = useState("");
  const [ecoMaterialDisposition, setEcoMaterialDisposition] = useState("");
  const [ecoDecisions, setEcoDecisions] = useState<
    Record<string, { decision: EcoDecision; note: string }>
  >({});

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const [documentsResponse, ecoResponse] = await Promise.all([
        api.get<EngineeringDocument[]>("/engineering-documents", {
          params: search.trim() ? { search: search.trim() } : undefined,
        }),
        api.get<EngineeringChangeOrder[]>("/engineering-change-orders"),
      ]);
      setDocuments(documentsResponse.data);
      setChangeOrders(ecoResponse.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "工程文档加载失败");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const uploadFile = async (selected: File) => {
    const form = new FormData();
    form.append("file", selected);
    const response = await api.post<{
      id: string;
      checksumSha256: string;
    }>("/files/upload?folder=engineering", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
  };

  const resetCreateForm = () => {
    setTitle("");
    setDocumentType("DRAWING");
    setExternalNo("");
    setProductId("");
    setOrderId("");
    setNotes("");
    setFile(null);
  };

  const createDocument = async () => {
    if (!title.trim() || !file || (!productId && !orderId)) {
      toast.error("请填写标题、关联产品或订单，并选择文件");
      return;
    }
    setBusyKey("create");
    try {
      const uploaded = await uploadFile(file);
      await api.post("/engineering-documents", {
        title: title.trim(),
        documentType,
        externalNo: externalNo.trim() || undefined,
        productId: productId || undefined,
        orderId: orderId || undefined,
        fileRecordId: uploaded.id,
        notes: notes.trim() || undefined,
      });
      toast.success("工程文档草稿已创建");
      setCreateOpen(false);
      resetCreateForm();
      await loadDocuments();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "工程文档创建失败");
    } finally {
      setBusyKey(null);
    }
  };

  const addRevision = async () => {
    if (!revisionTarget || !revisionFile) {
      toast.error("请选择新版本文件");
      return;
    }
    setBusyKey(`${revisionTarget.id}:revision`);
    try {
      const uploaded = await uploadFile(revisionFile);
      await api.post(`/engineering-documents/${revisionTarget.id}/revisions`, {
        fileRecordId: uploaded.id,
        notes: revisionNotes.trim() || undefined,
      });
      toast.success("新工程版本已创建");
      setRevisionTarget(null);
      setRevisionFile(null);
      setRevisionNotes("");
      await loadDocuments();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "新版本创建失败");
    } finally {
      setBusyKey(null);
    }
  };

  const runAction = async (
    revision: EngineeringRevision,
    action: "submit" | "release",
  ) => {
    setBusyKey(`${revision.id}:${action}`);
    try {
      await api.post(
        `/engineering-documents/revisions/${revision.id}/${action}`,
        {},
      );
      toast.success(action === "submit" ? "已提交校审" : "版本已批准并发布");
      await loadDocuments();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusyKey(null);
    }
  };

  const reviewRevision = async (decision: "APPROVE" | "REQUEST_CHANGES") => {
    if (!reviewTarget) return;
    if (decision === "REQUEST_CHANGES" && !reviewComment.trim()) {
      toast.error("退回修改必须填写意见");
      return;
    }
    setBusyKey(`${reviewTarget.id}:review`);
    try {
      await api.post(
        `/engineering-documents/revisions/${reviewTarget.id}/review`,
        {
          decision,
          comment: reviewComment.trim() || undefined,
        },
      );
      toast.success(
        decision === "APPROVE" ? "校审通过，等待批准" : "已退回设计修改",
      );
      setReviewTarget(null);
      setReviewComment("");
      await loadDocuments();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "校审操作失败");
    } finally {
      setBusyKey(null);
    }
  };

  const openEco = async (
    document: EngineeringDocument,
    revision: EngineeringRevision,
  ) => {
    setEcoTarget({ document, revision });
    setBusyKey(`${revision.id}:eco-preview`);
    try {
      const response = await api.get<EcoPreview>(
        `/engineering-change-orders/preview/${document.id}/${revision.id}`,
      );
      setEcoPreview(response.data);
      setEcoDecisions(
        Object.fromEntries(
          response.data.affectedWorkOrders.map((workOrder) => [
            workOrder.id,
            { decision: "SWITCH_NEW" as EcoDecision, note: "" },
          ]),
        ),
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "工程变更影响预览失败",
      );
      setEcoTarget(null);
    } finally {
      setBusyKey(null);
    }
  };

  const closeEco = () => {
    setEcoTarget(null);
    setEcoPreview(null);
    setEcoReason("");
    setEcoImpactAssessment("");
    setEcoMaterialDisposition("");
    setEcoDecisions({});
  };

  const createEco = async () => {
    if (!ecoTarget || !ecoPreview) return;
    if (
      !ecoReason.trim() ||
      !ecoImpactAssessment.trim() ||
      !ecoMaterialDisposition.trim()
    ) {
      toast.error("请完整填写变更原因、影响评估和物料处置");
      return;
    }
    const missingNote = Object.values(ecoDecisions).some(
      (item) => item.decision !== "SWITCH_NEW" && !item.note.trim(),
    );
    if (missingNote) {
      toast.error("继续旧版或报废返工必须填写处置说明");
      return;
    }
    setBusyKey(`${ecoTarget.revision.id}:eco-create`);
    try {
      const response = await api.post<{ id: string }>(
        `/engineering-change-orders/${ecoTarget.document.id}`,
        {
          targetRevisionId: ecoTarget.revision.id,
          reason: ecoReason.trim(),
          impactAssessment: ecoImpactAssessment.trim(),
          materialDisposition: ecoMaterialDisposition.trim(),
          impacts: ecoPreview.affectedWorkOrders.map((workOrder) => ({
            workOrderId: workOrder.id,
            decision: ecoDecisions[workOrder.id]?.decision ?? "SWITCH_NEW",
            note: ecoDecisions[workOrder.id]?.note.trim() || undefined,
          })),
        },
      );
      await api.post(
        `/engineering-change-orders/${response.data.id}/submit`,
        {},
      );
      toast.success("工程变更单已创建并提交批准");
      closeEco();
      await loadDocuments();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "工程变更单创建失败",
      );
    } finally {
      setBusyKey(null);
    }
  };

  const decideEco = async (
    eco: EngineeringChangeOrder,
    decision: "APPROVE" | "REJECT",
  ) => {
    const comment =
      decision === "REJECT"
        ? window.prompt("请输入驳回原因")?.trim()
        : undefined;
    if (decision === "REJECT" && !comment) return;
    setBusyKey(`${eco.id}:decision`);
    try {
      await api.post(`/engineering-change-orders/${eco.id}/decision`, {
        decision,
        comment,
      });
      toast.success(
        decision === "APPROVE" ? "工程变更已批准并应用" : "工程变更已驳回",
      );
      await loadDocuments();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "工程变更审批失败");
    } finally {
      setBusyKey(null);
    }
  };

  const downloadRevision = async (revision: EngineeringRevision) => {
    try {
      const response = await api.get<{ url: string }>("/files/download-url", {
        params: { path: revision.fileRecord.objectKey },
      });
      window.open(response.data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "下载链接获取失败");
    }
  };

  const releasedCount = documents.filter(
    (document) => document.currentReleasedRevisionId,
  ).length;
  const pendingCount = documents.filter((document) =>
    ["PENDING_REVIEW", "PENDING_APPROVAL"].includes(
      document.revisions[0]?.status ?? "",
    ),
  ).length;

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
            Engineering control
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">
            工程文档工作台
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            图纸与规范按版本校审、批准、发布；已发布二进制不可覆盖。
          </p>
        </div>
        {can("engineeringDocument:create") ? (
          <Button
            icon={<FilePlus2 className="h-4 w-4" />}
            onClick={() => setCreateOpen(true)}
          >
            新建工程文档
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="受控文档"
          value={documents.length}
          icon={FileText}
          tone="blue"
        />
        <StatCard
          label="已发布"
          value={releasedCount}
          icon={ShieldCheck}
          tone="green"
        />
        <StatCard
          label="待处理"
          value={pendingCount}
          icon={History}
          tone="indigo"
        />
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row">
        <label className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            aria-label="搜索工程文档"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索文档号、标题或外部图号"
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm"
          />
        </label>
        <Button
          variant="secondary"
          icon={<RefreshCw className="h-4 w-4" />}
          onClick={() => void loadDocuments()}
        >
          刷新
        </Button>
      </div>

      {changeOrders.length > 0 ? (
        <section className="rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-indigo-700" />
            <div>
              <h2 className="text-sm font-semibold text-indigo-950">
                工程变更单
              </h2>
              <p className="text-xs text-indigo-700">
                逐单记录在制工单的版本处置决定。
              </p>
            </div>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {changeOrders.map((eco) => (
              <article
                key={eco.id}
                className="rounded-xl border border-indigo-100 bg-white p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-xs font-bold text-indigo-700">
                      {eco.ecoNo}
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-slate-900">
                      {eco.engineeringDocument.documentNo} · R
                      {String(eco.sourceRevision.revisionNo).padStart(2, "0")} →
                      R{String(eco.targetRevision.revisionNo).padStart(2, "0")}
                    </p>
                  </div>
                  <Badge status={eco.status}>{eco.status}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-slate-600">
                  {eco.reason}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {eco.impacts.map((impact) => (
                    <span
                      key={impact.id}
                      className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600"
                    >
                      {impact.workOrder.workOrderNo} ·{" "}
                      {ecoDecisionLabels[impact.decision]}
                    </span>
                  ))}
                </div>
                {eco.status === "PENDING_APPROVAL" &&
                can("engineeringDocument:approve") ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busyKey === `${eco.id}:decision`}
                      onClick={() => void decideEco(eco, "REJECT")}
                    >
                      驳回
                    </Button>
                    <Button
                      size="sm"
                      loading={busyKey === `${eco.id}:decision`}
                      onClick={() => void decideEco(eco, "APPROVE")}
                    >
                      批准并应用
                    </Button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : documents.length === 0 ? (
        <EmptyState
          title="暂无工程文档"
          description="上传首份图纸或技术规范，开始受控版本流程。"
          icon={<FileText className="h-6 w-6" />}
        />
      ) : (
        <div className="space-y-4">
          {documents.map((document) => (
            <DocumentCard
              key={document.id}
              document={document}
              busyKey={busyKey}
              can={can}
              onAddRevision={setRevisionTarget}
              onSubmit={(revision) => void runAction(revision, "submit")}
              onReview={setReviewTarget}
              onRelease={(revision) => void runAction(revision, "release")}
              onCreateEco={(revision) => void openEco(document, revision)}
              onDownload={(revision) => void downloadRevision(revision)}
            />
          ))}
        </div>
      )}

      <Sheet
        open={createOpen}
        title="新建工程文档"
        onClose={() => setCreateOpen(false)}
      >
        <div className="space-y-4">
          <Field label="文档标题" htmlFor="engineering-title">
            <input
              id="engineering-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="文档类型" htmlFor="engineering-type">
            <select
              id="engineering-type"
              value={documentType}
              onChange={(event) => setDocumentType(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {Object.entries(typeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="外部图号（可选）" htmlFor="engineering-external-no">
            <input
              id="engineering-external-no"
              value={externalNo}
              onChange={(event) => setExternalNo(event.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="关联产品" htmlFor="engineering-product">
            <AsyncSelect
              id="engineering-product"
              value={productId}
              reference={{
                model: "product",
                labelField: "name",
                valueField: "id",
              }}
              onChange={setProductId}
              placeholder="按 SKU 或名称搜索产品"
            />
          </Field>
          <Field label="关联销售订单（可选）" htmlFor="engineering-order">
            <AsyncSelect
              id="engineering-order"
              value={orderId}
              reference={{
                model: "order",
                labelField: "orderNo",
                valueField: "id",
              }}
              onChange={setOrderId}
              placeholder="按订单号搜索"
            />
          </Field>
          <FilePicker label="版本文件" file={file} onChange={setFile} />
          <Field label="版本说明" htmlFor="engineering-notes">
            <textarea
              id="engineering-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </Field>
          <Button
            className="w-full"
            loading={busyKey === "create"}
            onClick={() => void createDocument()}
          >
            创建草稿版本
          </Button>
        </div>
      </Sheet>

      <Sheet
        open={Boolean(revisionTarget)}
        title={`上传新版本 · ${revisionTarget?.documentNo ?? ""}`}
        onClose={() => setRevisionTarget(null)}
      >
        <div className="space-y-4">
          <FilePicker
            label="新版本文件"
            file={revisionFile}
            onChange={setRevisionFile}
          />
          <Field label="变更说明" htmlFor="engineering-revision-notes">
            <textarea
              id="engineering-revision-notes"
              value={revisionNotes}
              onChange={(event) => setRevisionNotes(event.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </Field>
          <Button
            className="w-full"
            loading={Boolean(
              revisionTarget && busyKey === `${revisionTarget.id}:revision`,
            )}
            onClick={() => void addRevision()}
          >
            创建下一版本
          </Button>
        </div>
      </Sheet>

      <Sheet
        open={Boolean(ecoTarget)}
        title={`工程变更影响评估 · ${ecoTarget?.document.documentNo ?? ""}`}
        onClose={closeEco}
      >
        {!ecoPreview ? (
          <div className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">
              R{String(ecoPreview.sourceRevision.revisionNo).padStart(2, "0")} →
              R{String(ecoPreview.targetRevision.revisionNo).padStart(2, "0")}
              ，影响在制工单 {ecoPreview.affectedWorkOrders.length} 张
            </div>
            <Field label="变更原因" htmlFor="eco-reason">
              <textarea
                id="eco-reason"
                value={ecoReason}
                onChange={(event) => setEcoReason(event.target.value)}
                rows={3}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="影响评估" htmlFor="eco-impact-assessment">
              <textarea
                id="eco-impact-assessment"
                value={ecoImpactAssessment}
                onChange={(event) => setEcoImpactAssessment(event.target.value)}
                rows={3}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="物料处置" htmlFor="eco-material-disposition">
              <textarea
                id="eco-material-disposition"
                value={ecoMaterialDisposition}
                onChange={(event) =>
                  setEcoMaterialDisposition(event.target.value)
                }
                rows={3}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </Field>
            <div className="space-y-3">
              {ecoPreview.affectedWorkOrders.map((workOrder) => {
                const disposition = ecoDecisions[workOrder.id] ?? {
                  decision: "SWITCH_NEW" as EcoDecision,
                  note: "",
                };
                return (
                  <div
                    key={workOrder.id}
                    className="rounded-xl border border-slate-200 p-3"
                  >
                    <p className="text-sm font-semibold text-slate-900">
                      {workOrder.workOrderNo} · {workOrder.product.sku}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {workOrder.order.orderNo} · {workOrder.status} · 已报{" "}
                      {workOrder.actualQty}/{workOrder.plannedQty}
                    </p>
                    <select
                      aria-label={`${workOrder.workOrderNo} 处置决定`}
                      value={disposition.decision}
                      onChange={(event) =>
                        setEcoDecisions((current) => ({
                          ...current,
                          [workOrder.id]: {
                            ...disposition,
                            decision: event.target.value as EcoDecision,
                          },
                        }))
                      }
                      className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    >
                      {Object.entries(ecoDecisionLabels).map(
                        ([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ),
                      )}
                    </select>
                    {disposition.decision !== "SWITCH_NEW" ? (
                      <textarea
                        aria-label={`${workOrder.workOrderNo} 处置说明`}
                        value={disposition.note}
                        onChange={(event) =>
                          setEcoDecisions((current) => ({
                            ...current,
                            [workOrder.id]: {
                              ...disposition,
                              note: event.target.value,
                            },
                          }))
                        }
                        rows={2}
                        placeholder="填写偏差批准号、返工或报废处置说明"
                        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
            <Button
              className="w-full"
              loading={busyKey === `${ecoTarget?.revision.id}:eco-create`}
              onClick={() => void createEco()}
            >
              创建并提交工程变更单
            </Button>
          </div>
        )}
      </Sheet>

      <Sheet
        open={Boolean(reviewTarget)}
        title={`校审 R${String(reviewTarget?.revisionNo ?? 0).padStart(2, "0")}`}
        onClose={() => setReviewTarget(null)}
      >
        <div className="space-y-4">
          <Field label="校审意见" htmlFor="engineering-review-comment">
            <textarea
              id="engineering-review-comment"
              value={reviewComment}
              onChange={(event) => setReviewComment(event.target.value)}
              rows={5}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="danger"
              icon={<XCircle className="h-4 w-4" />}
              loading={Boolean(
                reviewTarget && busyKey === `${reviewTarget.id}:review`,
              )}
              onClick={() => void reviewRevision("REQUEST_CHANGES")}
            >
              退回修改
            </Button>
            <Button
              icon={<CheckCircle2 className="h-4 w-4" />}
              loading={Boolean(
                reviewTarget && busyKey === `${reviewTarget.id}:review`,
              )}
              onClick={() => void reviewRevision("APPROVE")}
            >
              校审通过
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function DocumentCard({
  document,
  busyKey,
  can,
  onAddRevision,
  onSubmit,
  onReview,
  onRelease,
  onCreateEco,
  onDownload,
}: {
  document: EngineeringDocument;
  busyKey: string | null;
  can: (permission: string) => boolean;
  onAddRevision: (document: EngineeringDocument) => void;
  onSubmit: (revision: EngineeringRevision) => void;
  onReview: (revision: EngineeringRevision) => void;
  onRelease: (revision: EngineeringRevision) => void;
  onCreateEco: (revision: EngineeringRevision) => void;
  onDownload: (revision: EngineeringRevision) => void;
}) {
  const latest = document.revisions[0];
  const canAddRevision =
    latest &&
    ["RELEASED", "OBSOLETE", "CHANGES_REQUESTED"].includes(latest.status);
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold text-blue-700">
              {document.documentNo}
            </span>
            <Badge status={latest?.status}>
              {statusLabels[latest?.status] ?? latest?.status}
            </Badge>
            <span className="text-xs text-slate-500">
              {typeLabels[document.documentType] ?? document.documentType}
            </span>
          </div>
          <h2 className="mt-1 truncate text-base font-semibold text-slate-950">
            {document.title}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {document.product
              ? `${document.product.sku} · ${document.product.name}`
              : "未关联产品"}
            {document.order ? ` · ${document.order.orderNo}` : ""}
            {document.externalNo ? ` · 外部图号 ${document.externalNo}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {latest?.status === "DRAFT" && can("engineeringDocument:create") ? (
            <Button
              size="sm"
              loading={busyKey === `${latest.id}:submit`}
              icon={<Send className="h-4 w-4" />}
              onClick={() => onSubmit(latest)}
            >
              提交校审
            </Button>
          ) : null}
          {latest?.status === "PENDING_REVIEW" &&
          can("engineeringDocument:review") ? (
            <Button size="sm" variant="info" onClick={() => onReview(latest)}>
              开始校审
            </Button>
          ) : null}
          {latest?.status === "PENDING_APPROVAL" &&
          can("engineeringDocument:approve") ? (
            document.currentReleasedRevisionId ? (
              <Button
                size="sm"
                variant="info"
                loading={busyKey === `${latest.id}:eco-preview`}
                icon={<ClipboardCheck className="h-4 w-4" />}
                onClick={() => onCreateEco(latest)}
              >
                影响评估 / ECO
              </Button>
            ) : (
              <Button
                size="sm"
                loading={busyKey === `${latest.id}:release`}
                icon={<ShieldCheck className="h-4 w-4" />}
                onClick={() => onRelease(latest)}
              >
                批准首版发布
              </Button>
            )
          ) : null}
          {canAddRevision && can("engineeringDocument:create") ? (
            <Button
              size="sm"
              variant="secondary"
              icon={<UploadCloud className="h-4 w-4" />}
              onClick={() => onAddRevision(document)}
            >
              上传新版本
            </Button>
          ) : null}
        </div>
      </header>
      <div className="divide-y divide-slate-100">
        {document.revisions.map((revision) => (
          <div
            key={revision.id}
            className="grid gap-3 px-5 py-3 md:grid-cols-[100px_1fr_auto] md:items-center"
          >
            <div>
              <p className="font-mono text-sm font-semibold text-slate-800">
                R{String(revision.revisionNo).padStart(2, "0")}
              </p>
              <Badge status={revision.status}>
                {statusLabels[revision.status] ?? revision.status}
              </Badge>
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">
                {revision.fileRecord.fileName}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                设计：{revision.creator.name}
                {revision.reviewer ? ` · 校审：${revision.reviewer.name}` : ""}
                {revision.approver ? ` · 批准：${revision.approver.name}` : ""}
              </p>
              {revision.reviewComment ? (
                <p className="mt-1 text-xs text-amber-700">
                  意见：{revision.reviewComment}
                </p>
              ) : null}
              <p className="mt-1 truncate font-mono text-[10px] text-slate-400">
                SHA-256 {revision.checksumSha256}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon={<Download className="h-4 w-4" />}
              onClick={() => onDownload(revision)}
            >
              下载
            </Button>
          </div>
        ))}
      </div>
    </article>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-xs font-semibold text-slate-600"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function FilePicker({
  label,
  file,
  onChange,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="block cursor-pointer rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center hover:bg-slate-100">
      <UploadCloud className="mx-auto h-5 w-5 text-slate-500" />
      <span className="mt-2 block text-sm font-medium text-slate-700">
        {file?.name ?? label}
      </span>
      <span className="mt-1 block text-xs text-slate-500">
        PDF、图片、Office 文档或文本文件
      </span>
      <input
        aria-label={label}
        type="file"
        className="hidden"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
    </label>
  );
}
