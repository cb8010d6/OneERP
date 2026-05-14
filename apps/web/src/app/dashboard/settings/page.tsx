'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { Users, Building2, Settings } from 'lucide-react';
import { CustomFieldDesigner, DynamicView } from '@/components/core';
import { EmployeeManagement } from '@/components/settings/EmployeeManagement';

interface Company {
  id: string;
  name: string;
}

export default function SettingsPage() {
  const { currentCompanyId, companies } = useAuthStore();
  const [company, setCompany] = useState<Company | null>(null);
  const [activeTab, setActiveTab] = useState<'users' | 'departments' | 'customFields' | 'info'>('users');
  const [localIp, setLocalIp] = useState('本机IP');

  useEffect(() => {
    setLocalIp(window.location.hostname);
    if (currentCompanyId) {
      const found = companies?.find(c => c.id === currentCompanyId);
      setCompany(found ? { id: found.id, name: found.name } : { id: currentCompanyId, name: '企业配置' });
    }
  }, [currentCompanyId, companies]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">系统设置</h2>
          <p className="text-sm text-gray-500 mt-1">企业信息、人员角色、应用级别配置</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="flex border-b border-gray-200 bg-gray-50">
          <button 
            onClick={() => setActiveTab('users')} 
            className={`px-6 py-4 text-sm font-medium flex items-center ${activeTab === 'users' ? 'bg-white text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Users className="h-4 w-4 mr-2" /> 员工与账号
          </button>
          <button 
            onClick={() => setActiveTab('departments')} 
            className={`px-6 py-4 text-sm font-medium flex items-center ${activeTab === 'departments' ? 'bg-white text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Building2 className="h-4 w-4 mr-2" /> 组织架构
          </button>
          <button 
            onClick={() => setActiveTab('info')} 
            className={`px-6 py-4 text-sm font-medium flex items-center ${activeTab === 'info' ? 'bg-white text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Settings className="h-4 w-4 mr-2" /> 系统与企业号
          </button>
          <button
            onClick={() => setActiveTab('customFields')}
            className={`px-6 py-4 text-sm font-medium flex items-center ${activeTab === 'customFields' ? 'bg-white text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Settings className="h-4 w-4 mr-2" /> 自定义字段
          </button>
        </div>

        <div className="p-6">
          {activeTab === 'users' && (
            <EmployeeManagement />
          )}

          {activeTab === 'departments' && (
            <DynamicView modelName="department" title="组织架构" />
          )}

          {activeTab === 'info' && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h3 className="text-lg font-bold mb-2 text-gray-900 border-b pb-2">企业基础信息</h3>
                <div className="grid grid-cols-2 gap-6 mt-4">
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-600">当前激活组织 (ID: {company?.id})</label>
                    <input type="text" disabled value={company?.name || ''} className="w-full bg-gray-100 border border-gray-300 rounded p-2 text-gray-500 cursor-not-allowed" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-600">工厂纳税人识别号</label>
                    <input type="text" placeholder="输入税号" className="w-full bg-white border border-gray-300 rounded p-2 text-gray-900 focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <h3 className="text-lg font-bold mb-2 text-gray-900 border-b pb-2">PDA终端扫码配置</h3>
                <div className="bg-yellow-50 text-yellow-800 p-4 rounded-lg flex items-start border border-yellow-200">
                  <p className="text-sm"><strong>提示：</strong> 要使移动端 PDA 设备能够正常扫码通讯，请确保移动设备和本服务器处于同一局域网内，并在 App 设置中修改 API 地址为：<br/><br/><code>http://{localIp}:8000/api</code></p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'customFields' && (
            <CustomFieldDesigner />
          )}
        </div>
      </div>
    </div>
  );
}
