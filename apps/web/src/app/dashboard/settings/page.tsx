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
  }, [currentCompanyId, companies]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            {t('settingsTitle')}
          </h2>
          <p className="text-sm text-gray-500 mt-1">{t('settingsSubtitle')}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="flex overflow-x-auto border-b border-gray-200 bg-gray-50">
          <button
            onClick={() => setActiveTab('users')}
            className={`px-6 py-4 text-sm font-medium flex items-center ${activeTab === 'users' ? 'bg-white text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Users className="h-4 w-4 mr-2" /> {t('settingsUsers')}
          </button>
          <button
            onClick={() => setActiveTab('departments')}
            className={`px-6 py-4 text-sm font-medium flex items-center ${activeTab === 'departments' ? 'bg-white text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Building2 className="h-4 w-4 mr-2" /> {t('settingsDepartments')}
          </button>
          <button
            onClick={() => setActiveTab('info')}
            className={`px-6 py-4 text-sm font-medium flex items-center ${activeTab === 'info' ? 'bg-white text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Settings className="h-4 w-4 mr-2" /> {t('settingsCompany')}
          </button>
          <button
            onClick={() => setActiveTab('customFields')}
            className={`px-6 py-4 text-sm font-medium flex items-center ${activeTab === 'customFields' ? 'bg-white text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Settings className="h-4 w-4 mr-2" /> {t('settingsCustomFields')}
          </button>
          <button
            onClick={() => setActiveTab('ai')}
            className={`px-6 py-4 text-sm font-medium flex items-center whitespace-nowrap ${activeTab === 'ai' ? 'bg-white text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Bot className="h-4 w-4 mr-2" /> {t('settingsAI')}
          </button>
        </div>

        <div className="p-6">
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
                <div className="grid grid-cols-2 gap-6 mt-4">
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
                <div className="bg-yellow-50 text-yellow-800 p-4 rounded-lg flex items-start border border-yellow-200">
                  <p className="text-sm">
                    {t('settingsPdaHint')}
                    <br />
                    <br />
                    <code>http://{localIp}:8000/api</code>
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
