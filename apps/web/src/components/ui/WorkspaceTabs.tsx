'use client';

import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useWorkspaceTabsStore } from '@/store/workspaceTabsStore';
import { useI18n } from '@/lib/i18n';

export function WorkspaceTabs() {
  const router = useRouter();
  const { tabs, activePath, closeTab, activateTab } = useWorkspaceTabsStore();
  const { t } = useI18n();

  return (
    <nav aria-label={t('workspacePages')} className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-gray-200 bg-gray-50 px-3 py-1.5">
      {tabs.map((tab) => {
        const active = tab.path === activePath;
        return (
          <div
            key={tab.path}
            className={`group inline-flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition ${
              active
                ? 'border-blue-200 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            <button
              type="button"
              aria-current={active ? 'page' : undefined}
              className="max-w-52 truncate rounded-sm focus-visible:outline-2 focus-visible:outline-blue-600 focus-visible:outline-offset-2"
              title={tab.path === '/dashboard' ? t('navOverview') : tab.label}
              onClick={() => {
                activateTab(tab.path);
                router.push(tab.path);
              }}
            >
              {tab.path === '/dashboard' ? t('navOverview') : tab.label}
            </button>

            {tab.path !== '/dashboard' ? (
              <button
                type="button"
                aria-label={`${t('commonClose')} ${tab.label}`}
                onClick={() => {
                  closeTab(tab.path);
                  if (active) {
                    router.push(useWorkspaceTabsStore.getState().activePath || '/dashboard');
                  }
                }}
                className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700 focus-visible:outline-2 focus-visible:outline-blue-600"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
