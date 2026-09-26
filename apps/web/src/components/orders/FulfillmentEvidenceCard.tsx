'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { AlertTriangle, Boxes, Factory, PackageSearch } from 'lucide-react';
import { formatNumber } from '@/lib/format';
import {
  canReadOrderEvidenceLink,
  parseFulfillmentEvidence,
  type FulfillmentAssessment,
  type FulfillmentEvidence,
  type FulfillmentMaterialDemandGroup,
} from '@/lib/order-fulfillment-evidence';
import { useI18n, type Language, type TranslationKey } from '@/lib/i18n';

export type FulfillmentEvidenceLoadState =
  | 'loading'
  | 'error'
  | 'unavailable'
  | 'ready';

const assessmentLabels: Record<FulfillmentAssessment, TranslationKey> = {
  FULFILLED: 'orderEvidenceAssessmentFulfilled',
  ON_HAND_COVERAGE: 'orderEvidenceAssessmentOnHand',
  WORK_ORDER_COVERAGE: 'orderEvidenceAssessmentWorkOrder',
  SHORTAGE: 'orderEvidenceAssessmentShortage',
  DATA_REVIEW: 'orderEvidenceAssessmentDataReview',
};

const assessmentStyles: Record<FulfillmentAssessment, string> = {
  FULFILLED: 'bg-slate-100 text-slate-700 ring-slate-200',
  ON_HAND_COVERAGE: 'bg-blue-50 text-blue-700 ring-blue-100',
  WORK_ORDER_COVERAGE: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
  SHORTAGE: 'bg-red-50 text-red-700 ring-red-100',
  DATA_REVIEW: 'bg-amber-50 text-amber-800 ring-amber-100',
};

const issueLabels: Record<string, TranslationKey> = {
  EMPTY_ORDER: 'orderEvidenceIssueEmptyOrder',
  MISSING_OR_INACTIVE_PRODUCT: 'orderEvidenceIssueMissingProduct',
  UNMAPPED_PRODUCT: 'orderEvidenceIssueUnmappedProduct',
  INVALID_ORDER_QUANTITY: 'orderEvidenceIssueInvalidOrderQuantity',
  UNMATCHED_WORK_ORDER_PRODUCT: 'orderEvidenceIssueUnmatchedWorkOrder',
  INVALID_WORK_ORDER_QUANTITY: 'orderEvidenceIssueInvalidWorkOrderQuantity',
  UNMATCHED_SHIPMENT_MATERIAL: 'orderEvidenceIssueUnmatchedShipment',
  INVALID_SHIPMENT_QUANTITY: 'orderEvidenceIssueInvalidShipmentQuantity',
  INVALID_STOCK_QUANTITY: 'orderEvidenceIssueInvalidStockQuantity',
  INVALID_NET_SHIPPED_QUANTITY: 'orderEvidenceIssueInvalidNetShippedQuantity',
  AMBIGUOUS_REVERSAL_OWNERSHIP: 'orderEvidenceIssueAmbiguousReversal',
  FOREIGN_MATERIAL_MAPPING: 'orderEvidenceIssueForeignMaterialMapping',
};

export function FulfillmentEvidenceAssessmentBadge({
  assessment,
}: {
  assessment: FulfillmentAssessment | null;
}) {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
        assessment
          ? assessmentStyles[assessment]
          : 'bg-slate-100 text-slate-600 ring-slate-200'
      }`}
    >
      {assessment ? t(assessmentLabels[assessment]) : t('orderEvidenceAssessmentUnknown')}
    </span>
  );
}

export function FulfillmentEvidenceCard({
  value,
  loadState,
  permissions = [],
}: {
  value: unknown;
  loadState: FulfillmentEvidenceLoadState;
  permissions?: readonly string[];
}) {
  const { language, t } = useI18n();
  const evidence = parseFulfillmentEvidence(value);

  return (
    <section
      aria-labelledby="order-fulfillment-evidence-title"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="order-fulfillment-evidence-title"
            className="flex items-center gap-2 text-lg font-bold text-slate-900"
          >
            <Boxes className="h-5 w-5 text-slate-500" />
            {t('orderEvidenceCardTitle')}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            {t('orderEvidenceCardHint')}
          </p>
        </div>
        {loadState === 'loading' ? null : (
          <FulfillmentEvidenceAssessmentBadge
            assessment={loadState === 'ready' && evidence ? evidence.assessment : null}
          />
        )}
      </div>

      {loadState === 'loading' ? (
        <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-600" role="status">
          {t('orderEvidenceLoading')}
        </div>
      ) : loadState === 'error' ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t('orderEvidenceLoadError')}</span>
        </div>
      ) : loadState === 'unavailable' || !evidence ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t('orderEvidenceUnavailable')}</span>
        </div>
      ) : (
        <EvidenceDetails evidence={evidence} language={language} />
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        {canReadOrderEvidenceLink(permissions, 'inventory:read') ? (
          <EvidenceLink href="/dashboard/inventory" icon={<PackageSearch className="h-3.5 w-3.5" />}>
            {t('orderEvidenceInventoryLink')}
          </EvidenceLink>
        ) : null}
        {canReadOrderEvidenceLink(permissions, 'production:read') &&
        canReadOrderEvidenceLink(permissions, 'inventory:read') &&
        canReadOrderEvidenceLink(permissions, 'order:read') ? (
          <EvidenceLink href="/dashboard/production" icon={<Factory className="h-3.5 w-3.5" />}>
            {t('orderEvidenceProductionLink')}
          </EvidenceLink>
        ) : null}
        {canReadOrderEvidenceLink(permissions, 'product:read') ? (
          <EvidenceLink href="/dashboard/dynamic/product" icon={<Boxes className="h-3.5 w-3.5" />}>
            {t('orderEvidenceProductLink')}
          </EvidenceLink>
        ) : null}
      </div>
    </section>
  );
}

function EvidenceDetails({
  evidence,
  language,
}: {
  evidence: FulfillmentEvidence;
  language: Language;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 md:grid-cols-2">
        <p>
          <span className="font-semibold text-slate-800">{t('orderEvidenceStockBasis')}: </span>
          {t('orderEvidenceStockBasisHint')}
        </p>
        <p>
          <span className="font-semibold text-slate-800">{t('orderEvidenceWorkOrderBasis')}: </span>
          {t('orderEvidenceWorkOrderBasisHint')}
        </p>
        <p className="md:col-span-2">{t('orderEvidenceNoLineAllocation')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
        <span>
          {t('orderEvidenceMaterialGroupCount')}: {evidence.materialDemandGroups.length}
        </span>
        {evidence.issues.length ? (
          <span className="text-amber-800">
            {t('orderEvidenceIssueCount')}: {evidence.issues.length}
          </span>
        ) : null}
      </div>

      {evidence.materialDemandGroups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
          {t('orderEvidenceNoGroups')}
        </p>
      ) : (
        <div className="space-y-3">
          {evidence.materialDemandGroups.map((group, index) => (
            <MaterialDemandGroupCard
              key={`${group.materialId ?? 'unmapped'}-${index}`}
              group={group}
              language={language}
            />
          ))}
        </div>
      )}

      {evidence.issues.length ? (
        <IssueList issues={evidence.issues} title={t('orderEvidenceDataIssues')} />
      ) : null}
    </div>
  );
}

function MaterialDemandGroupCard({
  group,
  language,
}: {
  group: FulfillmentMaterialDemandGroup;
  language: Language;
}) {
  const { t } = useI18n();
  const materialHeading = group.materialName?.trim()
    ? group.materialName
    : group.materialId
      ? t('orderEvidenceMaterialNamePending')
      : t('orderEvidenceUnmappedMaterial');
  const materialSku = group.materialSku?.trim();
  const materialUnit = group.materialUnit?.trim();

  return (
    <article className="rounded-lg border border-slate-200 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">
            {materialHeading}
          </h3>
          {materialSku || materialUnit ? (
            <p
              className="mt-1 break-words text-xs text-slate-500"
              aria-label={materialUnit ? `${t('orderEvidenceUnit')}: ${materialUnit}` : undefined}
            >
              {materialSku ? `${materialSku} · ` : ''}
              {materialUnit ?? ''}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-slate-500">
            {t('orderEvidenceRelatedOrderLines')}: {group.orderItemIds.length}
          </p>
        </div>
        <FulfillmentEvidenceAssessmentBadge assessment={group.assessment} />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <QuantityCell label={t('orderEvidenceOrdered')} value={group.orderedQty} language={language} />
        <QuantityCell label={t('orderEvidenceNetShipped')} value={group.netShippedQty} language={language} />
        <QuantityCell label={t('orderEvidenceRemaining')} value={group.remainingQty} language={language} />
        <QuantityCell label={t('orderEvidenceUnreservedStock')} value={group.onHandQty} language={language} />
        <QuantityCell label={t('orderEvidenceOpenWorkOrderQty')} value={group.openWorkOrderQty} language={language} />
        <QuantityCell label={t('orderEvidenceOnHandGap')} value={group.onHandGapQty} language={language} />
        <QuantityCell label={t('orderEvidenceProjectedGap')} value={group.projectedGapQty} language={language} />
      </dl>

      <details className="mt-3 text-xs text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-700">
          {t('orderEvidenceReferenceIds')}
        </summary>
        <dl className="mt-2 grid gap-1 break-all sm:grid-cols-2">
          <div>
            <dt className="font-semibold">{t('orderEvidenceMaterialId')}</dt>
            <dd>{group.materialId ?? t('orderEvidenceUnknownQuantity')}</dd>
          </div>
          <div>
            <dt className="font-semibold">{t('orderEvidenceRelatedProducts')}</dt>
            <dd>{group.productIds.length ? group.productIds.join(', ') : t('orderEvidenceNoProductIds')}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="font-semibold">{t('orderEvidenceOrderItemIds')}</dt>
            <dd>{group.orderItemIds.length ? group.orderItemIds.join(', ') : '—'}</dd>
          </div>
        </dl>
      </details>

      {group.issues.length ? (
        <IssueList issues={group.issues} title={t('orderEvidenceGroupIssues')} />
      ) : null}
    </article>
  );
}

function QuantityCell({
  label,
  value,
  language,
}: {
  label: string;
  value: number | null;
  language: Language;
}) {
  const { t } = useI18n();
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-semibold text-slate-900">
        {value === null ? t('orderEvidenceUnknownQuantity') : formatNumber(value, language, 4)}
      </dd>
    </div>
  );
}

function IssueList({ issues, title }: { issues: string[]; title: string }) {
  const { t } = useI18n();
  return (
    <div className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 list-inside list-disc space-y-0.5">
        {issues.map((issue, index) => (
          <li key={`${issue}-${index}`}>{issueLabels[issue] ? t(issueLabels[issue]) : issue}</li>
        ))}
      </ul>
    </div>
  );
}

function EvidenceLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
    >
      {icon}
      {children}
    </Link>
  );
}
