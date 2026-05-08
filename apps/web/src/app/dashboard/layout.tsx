'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Package, ShoppingCart, Users, Settings, FileText, LayoutDashboard, LogOut, PanelRight, Table, ClipboardList, Factory, Receipt, ListOrdered } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { CommandPalette } from '../../components/ai/CommandPalette';
import { WorkspaceTabs } from '../../components/ui/WorkspaceTabs';
import { useWorkspaceTabsStore } from '../../store/workspaceTabsStore';
import { PermissionsProvider } from '../../lib/permissions-context';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [rightOpen, setRightOpen] = useState(true);
  const { user, token, companies, currentCompanyId, setCurrentCompany, logout } = useAuthStore();
  const { openTab, activateTab, closeTab, activePath } = useWorkspaceTabsStore();

  const navItems = useMemo(() => [
    { icon: LayoutDashboard, label: '概览', href: '/dashboard' },
    { icon: ShoppingCart, label: '销售打单', href: '/dashboard/sales' },
    { icon: ListOrdered, label: '订单管理', href: '/dashboard/orders' },
    { icon: ClipboardList, label: '采购订单', href: '/dashboard/dynamic/purchaseOrder' },
    { icon: Package, label: '生产与库存', href: '/dashboard/inventory' },
    { icon: Factory, label: '生产管理', href: '/dashboard/production' },
    { icon: Receipt, label: '财务管理', href: '/dashboard/finance' },
    { icon: FileText, label: '图纸文档', href: '/dashboard/files' },
    { icon: Users, label: '客户管理', href: '/dashboard/customers' },
    { icon: Settings, label: '系统设置', href: '/dashboard/settings' },
    { icon: Table, label: '网格实验', href: '/dashboard/lab/data-grid' },
  ], []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && (!token || !user || !currentCompanyId)) {
      router.push('/login');
    }
  }, [mounted, token, user, currentCompanyId, router]);

  useEffect(() => {
    if (!pathname) return;
    const item = navItems.find((entry) => entry.href === pathname);
    openTab({
      id: pathname,
      path: pathname,
      label: item?.label || pathname.split('/').slice(-1)[0] || '工作区',
    });
  }, [navItems, openTab, pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMetaSave = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's';
      if (isMetaSave) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('erp:shortcut-save'));
        return;
      }

      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        const isInputTarget =
          target?.tagName === 'INPUT' ||
          target?.tagName === 'TEXTAREA' ||
          target?.tagName === 'SELECT' ||
          Boolean(target?.isContentEditable);

        if (!isInputTarget) {
          event.preventDefault();
          window.dispatchEvent(new CustomEvent('erp:open-command-palette'));
        }
      }

      if (event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        router.push('/dashboard/dynamic/order');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router]);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const handleCompanyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setCurrentCompany(e.target.value);
    window.location.reload(); 
  };

  if (!mounted) {
    return (
      <div className="flex h-screen bg-gray-50 items-center justify-center">
        <div className="text-gray-400">加载中...</div>
      </div>
    );
  }

  if (!token || !user || !currentCompanyId) return null;

  return (
    <PermissionsProvider>
      <div className="flex h-screen bg-gray-50">
        {/* Sidebar */}
        <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="h-16 flex items-center justify-center border-b border-gray-200">
          <h1 className="text-xl font-bold text-blue-600">OneERP</h1>
        </div>

        {/* Company Switcher */}
        <div className="p-4 border-b border-gray-200">
          <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">当前公司</label>
          <select 
            className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
            value={currentCompanyId || ''}
            onChange={handleCompanyChange}
          >
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <button
                key={item.href}
                onClick={() => router.push(item.href)}
                className={`w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                  isActive 
                    ? 'bg-blue-50 text-blue-700' 
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <item.icon className={`mr-3 h-5 w-5 ${isActive ? 'text-blue-700' : 'text-gray-400'}`} />
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold">
                {user?.username?.charAt(0)?.toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{user?.username || user?.name || 'User'}</p>
                <p className="text-xs text-gray-500">
                  {companies.find(c => c.id === currentCompanyId)?.role 
                    ? typeof companies.find(c => c.id === currentCompanyId)!.role === 'object' 
                      ? (companies.find(c => c.id === currentCompanyId)!.role as {name: string}).name 
                      : companies.find(c => c.id === currentCompanyId)!.role as string
                    : user?.role || 'Role'}
                </p>
              </div>
            </div>
            <button onClick={handleLogout} className="p-2 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-gray-100">
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="relative h-16 bg-white border-b border-gray-200 flex items-center px-8 shadow-sm justify-between">
            <h2 className="text-lg font-semibold text-gray-800">
                {navItems.find(i => i.href === pathname)?.label || '仪表盘'}
            </h2>
          <div className="absolute left-1/2 -translate-x-1/2">
            <CommandPalette />
          </div>
          <button
            type="button"
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
            onClick={() => setRightOpen((prev) => !prev)}
            title="切换右侧工作面板"
          >
            <PanelRight className="h-4 w-4" />
          </button>
        </header>
        <WorkspaceTabs />
        <div className="flex min-h-0 flex-1">
          <div className="flex-1 overflow-auto p-8">
            {children}
          </div>

          {rightOpen ? (
            <aside className="hidden w-72 border-l border-gray-200 bg-white p-4 xl:block">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">效率面板</h3>
              <div className="mt-3 space-y-2 text-xs text-gray-600">
                <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
                  <div className="font-medium text-gray-800">快捷键</div>
                  <div className="mt-1">Ctrl/Cmd+S 保存当前表单</div>
                  <div>/ 打开命令搜索</div>
                  <div>Alt+N 新建订单草稿</div>
                </div>
                <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
                  <div className="font-medium text-gray-800">多标签</div>
                  <div>当前标签: {activePath || '/dashboard'}</div>
                  <div className="mt-1">支持并行打开多个业务页面。</div>
                </div>
                <button
                  type="button"
                  className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-left hover:bg-gray-50"
                  onClick={() => {
                    closeTab(activePath || '/dashboard');
                    const next = useWorkspaceTabsStore.getState().activePath || '/dashboard';
                    activateTab(next);
                    router.push(next);
                  }}
                >
                  关闭当前标签
                </button>
              </div>
            </aside>
          ) : null}
        </div>
      </main>
    </div>
    </PermissionsProvider>
  );
}
