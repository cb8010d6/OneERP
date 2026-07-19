'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { Bot, Users, Building2, Settings } from 'lucide-react';
import { CustomFieldDesigner, DynamicView } from '@/components/core';
import { AISettingsPanel } from '@/components/settings/AISettingsPanel';
import { EmployeeManagement } from '@/components/settings/EmployeeManagement';
import { useI18n } from '@/lib/i18n';

interface Company {
  id: string;
  name: string;
}

export default function SettingsPage() {
  const { currentCompanyId, companies } = useAuthStore();
  const { t } = useI18n();
  const [company, setCompany] = useState<Company | null>(null);
  const [activeTab, setActiveTab] = useState<
    'users' | 'departments' | 'customFields' | 'info' | 'ai'
  >('users');
  const [localIp, setLocalIp] = useState('localhost');

  useEffect(() => {
    setLocalIp(window.location.hostname);
    if (currentCompanyId) {
      const found = companies?.find((c) => c.id === currentCompanyId);
      setCompany(
        found
          ? { id: found.id, name: found.name }
          : { id: currentCompanyId, name: t('settingsCompany') },
      );
    }
  }, [currentCompanyId, companies, t]);

  const tabButtonClass = (tab: typeof activeTab) =>
    `flex shrink-0 items-center whitespace-nowrap px-4 py-3 text-sm font-medium sm:px-6 sm:py-4 ${
      activeTab === tab
        ? 'border-b-2 border-blue-600 bg-white text-blue-600'
        : 'text-gray-500 hover:text-gray-700'
    }`;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold text-gray-900 sm:text-2xl">
            {t('settingsTitle')}
          </h2>
          <p className="text-sm text-gray-500 mt-1">{t('settingsSubtitle')}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm sm:rounded-xl">
        <div className="overflow-x-auto border-b border-gray-200 bg-gray-50">
          <div className="flex min-w-max">
            <button
              onClick={() => setActiveTab('users')}
              className={tabButtonClass('users')}
            >
              <Users className="h-4 w-4 mr-2" /> {t('settingsUsers')}
            </button>
            <button
              onClick={() => setActiveTab('departments')}
              className={tabButtonClass('departments')}
            >
              <Building2 className="h-4 w-4 mr-2" />{' '}
              {t('settingsDepartments')}
            </button>
            <button
              onClick={() => setActiveTab('info')}
              className={tabButtonClass('info')}
            >
              <Settings className="h-4 w-4 mr-2" /> {t('settingsCompany')}
            </button>
            <button
              onClick={() => setActiveTab('customFields')}
              className={tabButtonClass('customFields')}
            >
              <Settings className="h-4 w-4 mr-2" />{' '}
              {t('settingsCustomFields')}
            </button>
            <button
              onClick={() => setActiveTab('ai')}
              className={tabButtonClass('ai')}
            >
              <Bot className="h-4 w-4 mr-2" /> {t('settingsAI')}
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          {activeTab === 'users' && <EmployeeManagement />}

          {activeTab === 'departments' && (
            <DynamicView
              modelName="department"
              title={t('settingsDepartments')}
            />
          )}

          {activeTab === 'info' && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h3 className="text-lg font-bold mb-2 text-gray-900 border-b pb-2">
                  {t('settingsCompanyInfo')}
                </h3>
                <div className="grid gap-4 mt-4 sm:grid-cols-2 sm:gap-6">
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-600">
                      {t('settingsActiveOrg')} (ID: {company?.id})
                    </label>
                    <input
                      type="text"
                      disabled
                      value={company?.name || ''}
                      className="w-full bg-gray-100 border border-gray-300 rounded p-2 text-gray-500 cursor-not-allowed"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-600">
                      {t('settingsTaxId')}
                    </label>
                    <input
                      type="text"
                      placeholder={t('settingsTaxPlaceholder')}
                      className="w-full bg-white border border-gray-300 rounded p-2 text-gray-900 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <h3 className="text-lg font-bold mb-2 text-gray-900 border-b pb-2">
                  {t('settingsPdaTitle')}
                </h3>
                <div className="flex items-start rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-yellow-800">
                  <p className="min-w-0 text-sm">
                    {t('settingsPdaHint')}
                    <br />
                    <br />
                    <code className="break-all">http://{localIp}:8000/api</code>
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'customFields' && <CustomFieldDesigner />}

          {activeTab === 'ai' && <AISettingsPanel />}
        </div>
      </div>
    </div>
  );
}
