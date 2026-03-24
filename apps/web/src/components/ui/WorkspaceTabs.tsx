'use client';

import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useWorkspaceTabsStore } from '@/store/workspaceTabsStore';

export function WorkspaceTabs() {
  const router = useRouter();
  const { tabs, activePath, closeTab, activateTab } = useWorkspaceTabsStore();

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-gray-200 bg-gray-50 px-3 py-1.5">
      {tabs.map((tab) => {
        const active = tab.path === activePath;
        return (
          <div
            key={tab.path}
            className={`group inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition ${
              active
                ? 'border-blue-200 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                activateTab(tab.path);
                router.push(tab.path);
              }}
            >
              {tab.label}
            </button>

            {tab.path !== '/dashboard' ? (
              <button
                type="button"
                onClick={() => {
                  closeTab(tab.path);
                }}
                className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
