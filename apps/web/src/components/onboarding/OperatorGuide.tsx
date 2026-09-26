'use client';

import Link from 'next/link';
import {
  ArrowUpRight,
  Box,
  Building2,
  ClipboardList,
  PackageCheck,
  ShoppingCart,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { useAuthStore } from '@/store/authStore';

interface GuideAction {
  id: string;
  href: string;
  readPermission: string;
  createPermission?: string;
  createLabel: TranslationKey;
  viewLabel: TranslationKey;
}

interface GuideStep {
  title: TranslationKey;
  description: TranslationKey;
  Icon: LucideIcon;
  actions: GuideAction[];
}

function hasPermission(permissions: readonly string[], required: string) {
  if (permissions.includes('ALL') || permissions.includes(required)) return true;
  const [resource, action] = required.split(':');
  return (
    permissions.includes(`${resource}:*`) ||
    permissions.includes(`*:${action}`)
  );
}

const steps: GuideStep[] = [
  {
    title: 'dashboardGuidePartnerTitle',
    description: 'dashboardGuidePartnerDescription',
    Icon: Building2,
    actions: [
      {
        id: 'partner',
        href: '/dashboard/dynamic/partner',
        readPermission: 'partner:read',
        createPermission: 'partner:create',
        createLabel: 'dashboardGuidePartnerCreate',
        viewLabel: 'dashboardGuidePartnerView',
      },
    ],
  },
  {
    title: 'dashboardGuideMaterialTitle',
    description: 'dashboardGuideMaterialDescription',
    Icon: Box,
    actions: [
      {
        id: 'material',
        href: '/dashboard/dynamic/material',
        readPermission: 'material:read',
        createPermission: 'material:create',
        createLabel: 'dashboardGuideMaterialCreate',
        viewLabel: 'dashboardGuideMaterialView',
      },
    ],
  },
  {
    title: 'dashboardGuideLocationTitle',
    description: 'dashboardGuideLocationDescription',
    Icon: Warehouse,
    actions: [
      {
        id: 'stock-location',
        href: '/dashboard/dynamic/stockLocation',
        readPermission: 'stockLocation:read',
        createPermission: 'stockLocation:create',
        createLabel: 'dashboardGuideLocationCreate',
        viewLabel: 'dashboardGuideLocationView',
      },
    ],
  },
  {
    title: 'dashboardGuideProductTitle',
    description: 'dashboardGuideProductDescription',
    Icon: PackageCheck,
    actions: [
      {
        id: 'product',
        href: '/dashboard/dynamic/product',
        readPermission: 'product:read',
        createPermission: 'product:create',
        createLabel: 'dashboardGuideProductCreate',
        viewLabel: 'dashboardGuideProductView',
      },
    ],
  },
  {
    title: 'dashboardGuideTransactionTitle',
    description: 'dashboardGuideTransactionDescription',
    Icon: ShoppingCart,
    actions: [
      {
        id: 'purchase',
        href: '/dashboard/purchase',
        readPermission: 'purchase:read',
        createPermission: 'purchase:create',
        createLabel: 'dashboardGuidePurchaseCreate',
        viewLabel: 'dashboardGuidePurchaseView',
      },
      {
        id: 'sales',
        href: '/dashboard/sales',
        readPermission: 'order:read',
        createPermission: 'order:create',
        createLabel: 'dashboardGuideSalesCreate',
        viewLabel: 'dashboardGuideSalesView',
      },
    ],
  },
];

export function OperatorGuide() {
  const { companies, currentCompanyId } = useAuthStore();
  const { t } = useI18n();
  const currentPermissions =
    companies.find((company) => company.id === currentCompanyId)?.permissions ??
    [];

  const renderAction = (action: GuideAction) => {
    if (!hasPermission(currentPermissions, action.readPermission)) {
      return (
        <span
          key={action.id}
          className="inline-flex min-h-10 items-center rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          {t('dashboardGuideAskAdmin')}
        </span>
      );
    }

    const canCreate =
      action.createPermission !== undefined &&
      hasPermission(currentPermissions, action.createPermission);

    return (
      <Link
        key={action.id}
        href={action.href}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {t(canCreate ? action.createLabel : action.viewLabel)}
        <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
      </Link>
    );
  };

  const financeReviewActions: GuideAction[] = [
    {
      id: 'finance',
      href: '/dashboard/finance',
      readPermission: 'finance:read',
      createLabel: 'dashboardGuideFinanceOpen',
      viewLabel: 'dashboardGuideFinanceOpen',
    },
    {
      id: 'tax-codes',
      href: '/dashboard/dynamic/taxCode',
      readPermission: 'taxCode:read',
      createLabel: 'dashboardGuideTaxCodeView',
      viewLabel: 'dashboardGuideTaxCodeView',
    },
  ];

  return (
    <section
      aria-labelledby="operator-guide-title"
      className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm sm:p-6"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
          <ClipboardList aria-hidden="true" className="h-5 w-5" />
        </div>
        <div>
          <h2
            id="operator-guide-title"
            className="text-lg font-bold text-slate-900"
          >
            {t('dashboardGuideTitle')}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {t('dashboardGuideDescription')}
          </p>
        </div>
      </div>

      <aside className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/70 p-4">
        <h3 className="text-sm font-semibold text-indigo-950">
          {t('dashboardGuideFinanceReviewTitle')}
        </h3>
        <p className="mt-1 text-sm text-indigo-900">
          {t('dashboardGuideFinanceReviewDescription')}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {financeReviewActions.map(renderAction)}
        </div>
      </aside>

      <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {steps.map(({ title, description, Icon, actions }, index) => (
          <li
            key={title}
            className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-slate-50/70 p-4"
          >
            <div className="flex items-center gap-2 text-blue-700">
              <span
                aria-label={`${t('dashboardGuideStep')} ${index + 1}`}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-bold"
              >
                {index + 1}
              </span>
              <Icon aria-hidden="true" className="h-4 w-4" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-slate-900">
              {t(title)}
            </h3>
            <p className="mt-1 flex-1 text-sm leading-5 text-slate-600">
              {t(description)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">{actions.map(renderAction)}</div>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        {t('dashboardGuideManufacturingNote')}
      </p>
    </section>
  );
}
