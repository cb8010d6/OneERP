'use client';

import { useEffect, useState } from 'react';
import { DynamicView } from '@/components/core';
import { PurchaseWorkbench } from '@/components/purchase/PurchaseWorkbench';
import { useI18n, type TranslationKey } from '@/lib/i18n';

type PurchaseTab = 'purchaseOrder' | 'purchaseReceipt' | 'purchaseInvoice';

const tabs: Array<{
  key: PurchaseTab;
  labelKey: TranslationKey;
  titleKey: TranslationKey;
}> = [
  {
    key: 'purchaseOrder',
    labelKey: 'purchaseOrderTab',
    titleKey: 'purchaseOrderTitle',
  },
  {
    key: 'purchaseReceipt',
    labelKey: 'purchaseReceiptTab',
    titleKey: 'purchaseReceiptTitle',
  },
  {
    key: 'purchaseInvoice',
    labelKey: 'purchaseInvoiceTab',
    titleKey: 'purchaseInvoiceTitle',
  },
];

export default function PurchasePage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<PurchaseTab>('purchaseOrder');
  const current = tabs.find((tab) => tab.key === activeTab) ?? tabs[0];

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    if (tabs.some((tab) => tab.key === requestedTab)) {
      setActiveTab(requestedTab as PurchaseTab);
    }
  }, []);

  return (
    <div className="space-y-4">
      <PurchaseWorkbench />
      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition ${
              activeTab === tab.key
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>
      <DynamicView modelName={current.key} title={t(current.titleKey)} />
    </div>
  );
}
