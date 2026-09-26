'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  Factory,
  Package,
  PackageCheck,
  ReceiptText,
  ShoppingCart,
  Users,
  Settings,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelRight,
  Table,
  X,
} from 'lucide-react';
import { useAuthStore, isJwtTokenLikelyValid } from '../../store/authStore';
import { CommandPalette } from '../../components/ai/CommandPalette';
import { WorkspaceTabs } from '../../components/ui/WorkspaceTabs';
import { useWorkspaceTabsStore } from '../../store/workspaceTabsStore';
import { useI18n } from '../../lib/i18n';
import { resolveDashboardRoute } from '../../lib/dashboard-routes';

function hasPermission(permissions: readonly string[], required?: string) {
  if (!required) return true;
  if (permissions.includes('ALL') || permissions.includes(required))
    return true;
  const parts = required.split(':');
  const resource = parts[0];
  const action = parts[parts.length - 1];
  return (
    permissions.includes(`${resource}:*`) || permissions.includes(`*:${action}`)
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavRef = useRef<HTMLElement>(null);
  const mobileNavTriggerRef = useRef<HTMLButtonElement>(null);
  const {
    user,
    token,
    companies,
    currentCompanyId,
    setCurrentCompany,
    refreshPermissions,
    logout,
    restoreSession,
  } = useAuthStore();
  const { openTab, activateTab, closeTab, activePath } =
    useWorkspaceTabsStore();
  const { language, setLanguage, t } = useI18n();

  const currentPermissions =
    companies.find((company) => company.id === currentCompanyId)?.permissions ??
    [];
  const currentCompany = companies.find(
    (company) => company.id === currentCompanyId,
  );

  const navItems = useMemo(() => [
    { icon: LayoutDashboard, label: t('navOverview'), href: '/dashboard' },
    {
      icon: ShoppingCart,
      label: t('navSales'),
      href: '/dashboard/sales',
      permission: 'order:read',
    },
    {
      icon: PackageCheck,
      label: t('navPurchase'),
      href: '/dashboard/purchase',
      permission: 'purchase:read',
    },
    {
      icon: Package,
      label: t('navInventory'),
      href: '/dashboard/inventory',
      permission: 'inventory:read',
    },
    {
      icon: Factory,
      label: t('navProduction'),
      href: '/dashboard/production',
      permission: 'production:read',
    },
    {
      icon: ReceiptText,
      label: t('navFinance'),
      href: '/dashboard/finance',
      permission: 'finance:read',
    },
    {
      icon: FileText,
      label: t('navFiles'),
      href: '/dashboard/files',
      permission: 'fileRecord:read',
    },
    {
      icon: Users,
      label: t('navCustomers'),
      href: '/dashboard/customers',
      permission: 'partner:read',
    },
    {
      icon: Settings,
      label: t('navSettings'),
      href: '/dashboard/settings',
      permission: 'user:read',
    },
    {
      icon: Table,
      label: t('navGridLab'),
      href: '/dashboard/lab/data-grid',
      permission: 'ALL',
    },
  ], [t]);
  const workspaceRoutes = useMemo(
    () => [
      ...navItems,
      {
        label: t('navSalesRequirements'),
        href: '/dashboard/sales/requirements',
        permission: 'order:read',
      },
    ],
    [navItems, t],
  );
  const currentRoute = useMemo(
    () => resolveDashboardRoute(pathname, workspaceRoutes),
    [pathname, workspaceRoutes],
  );
  const visibleNavItems = navItems.filter((item) =>
    hasPermission(currentPermissions, item.permission),
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const drawer = mobileNavRef.current;
    const trigger = mobileNavTriggerRef.current;
    if (!drawer) return;
    const focusable = () => Array.from(drawer.querySelectorAll<HTMLElement>(
      'button:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
    ));
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileNavOpen(false);
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const onResize = () => {
      if (window.innerWidth >= 1024) setMobileNavOpen(false);
    };
    drawer.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      drawer.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
      trigger?.focus();
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mounted) return;

    let cancelled = false;
    if (token && user && currentCompanyId && isJwtTokenLikelyValid(token)) {
      void refreshPermissions().catch(() => {
        if (!cancelled) router.push('/login');
      });
      return () => {
        cancelled = true;
      };
    }

    restoreSession().then((restored) => {
      if (cancelled) return;
      if (!restored) {
        router.push('/login');
        return;
      }
      void refreshPermissions().catch(() => {
        if (!cancelled) router.push('/login');
      });
    });
    return () => {
      cancelled = true;
    };
  }, [mounted, token, user, currentCompanyId, restoreSession, refreshPermissions, router]);

  useEffect(() => {
    if (!pathname) return;
    setMobileNavOpen(false);
    openTab({
      id: pathname,
      path: pathname,
      label:
        currentRoute?.label ||
        pathname.split('/').slice(-1)[0] ||
        t('workspace'),
    });
  }, [currentRoute, openTab, pathname, t]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMetaSave =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's';
      if (isMetaSave) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('erp:shortcut-save'));
        return;
      }

      const isCommandK =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      if (isCommandK) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('erp:open-command-palette'));
        return;
      }

      if (
        event.key === '/' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
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

  const handleLogout = async () => {
    await logout();
    setMobileNavOpen(false);
    router.push('/login');
  };

  const handleNavigate = (href: string) => {
    setMobileNavOpen(false);
    router.push(href);
  };

  const handleCompanyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setCurrentCompany(e.target.value);
  };

  if (!mounted) {
    return (
      <div className="flex h-screen bg-gray-50 items-center justify-center">
        <div className="text-gray-400">{t('loading')}</div>
      </div>
    );
  }

  if (!token || !user || !currentCompanyId) return null;

  const sidebarContent = (
    <>
      <div className="h-16 flex items-center justify-center border-b border-gray-200">
        <h1 className="text-xl font-bold text-blue-600">OneERP</h1>
      </div>

      <div className="p-4 border-b border-gray-200">
        <label className="block text-xs font-medium text-gray-500 mb-1 uppercase">
          {t('currentCompany')}
        </label>
        <select
          aria-label={t('currentCompany')}
          className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
          value={currentCompanyId || ''}
          onChange={handleCompanyChange}
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <nav aria-label={t('primaryNavigation')} className="flex-1 p-4 space-y-1 overflow-y-auto">
        {visibleNavItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== '/dashboard' &&
              pathname.startsWith(`${item.href}/`));
          return (
            <button
              key={item.href}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => handleNavigate(item.href)}
              className={`w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <item.icon
                className={`mr-3 h-5 w-5 ${isActive ? 'text-blue-700' : 'text-gray-400'}`}
              />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center space-x-3">
            <div className="w-8 h-8 shrink-0 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold">
              {(user?.name || user?.username || user?.email || 'U')
                .charAt(0)
                .toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">
                {user?.name || user?.username || user?.email || 'User'}
              </p>
              <p className="truncate text-xs text-gray-500">
                {currentCompany?.role || user?.role || 'Role'}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t('signOut')}
            title={t('signOut')}
            onClick={handleLogout}
            className="p-2 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-gray-100"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-gray-50">
      <aside inert={mobileNavOpen} className="hidden w-60 shrink-0 bg-white border-r border-gray-200 lg:flex lg:flex-col">
        {sidebarContent}
      </aside>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            aria-label={t('closeNavigation')}
            tabIndex={-1}
            onClick={() => setMobileNavOpen(false)}
          />
          <aside ref={mobileNavRef} id="mobile-navigation" role="dialog" aria-modal="true" aria-label={t('primaryNavigation')} className="relative flex h-full w-[min(82vw,320px)] flex-col bg-white shadow-xl">
            <button
              type="button"
              className="absolute right-3 top-3 rounded-md p-2 text-gray-500 hover:bg-gray-100"
              aria-label={t('closeNavigation')}
              onClick={() => setMobileNavOpen(false)}
            >
              <X className="h-5 w-5" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      ) : null}

      {/* Main Content */}
      <main inert={mobileNavOpen} className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="h-14 shrink-0 sm:h-16 bg-white border-b border-gray-200 flex items-center gap-2 px-3 sm:px-6 lg:px-8">
          <button
            ref={mobileNavTriggerRef}
            type="button"
            className="rounded-md p-2 text-gray-600 hover:bg-gray-100 lg:hidden"
            aria-label={t('openNavigation')}
            aria-expanded={mobileNavOpen}
            aria-controls={mobileNavOpen ? 'mobile-navigation' : undefined}
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-gray-800 sm:text-lg">
            {currentRoute?.label || t('navOverview')}
          </h2>
          <div className="hidden min-w-0 shrink md:block">
            <CommandPalette key={`${user.id}:${currentCompanyId}`} />
          </div>
          <select
            value={language}
            onChange={(event) =>
              setLanguage(event.target.value as 'zh-CN' | 'en-US')
            }
            className="shrink-0 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600"
            aria-label="Language"
          >
            <option value="zh-CN">{t('languageChinese')}</option>
            <option value="en-US">{t('languageEnglish')}</option>
          </select>
          <button
            type="button"
            className={`hidden shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs hover:bg-gray-100 xl:inline-flex ${rightOpen ? 'bg-blue-50 text-blue-700' : 'text-gray-500'}`}
            onClick={() => setRightOpen((prev) => !prev)}
            title={t('toggleSidePanel')}
            aria-label={t('toggleSidePanel')}
            aria-expanded={rightOpen}
            aria-controls={rightOpen ? 'workspace-tools' : undefined}
          >
            <PanelRight className="h-4 w-4" />
            <span>{t('workspaceTools')}</span>
          </button>
        </header>
        <WorkspaceTabs />
        <div className="flex min-h-0 flex-1">
          <div
            key={`${user.id}:${currentCompanyId}`}
            className="min-w-0 flex-1 overflow-auto p-3 sm:p-5 lg:p-8"
          >
            {children}
          </div>

          {rightOpen ? (
            <aside id="workspace-tools" className="hidden w-64 shrink-0 overflow-y-auto border-l border-gray-200 bg-white p-4 xl:block">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">
                {t('productivityPanel')}
              </h3>
              <div className="mt-3 space-y-2 text-xs text-gray-600">
                <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
                  <div className="font-medium text-gray-800">
                    {t('shortcuts')}
                  </div>
                  <div className="mt-1">{t('shortcutSave')}</div>
                  <div>{t('shortcutSearch')}</div>
                  <div>{t('shortcutNewOrder')}</div>
                </div>
                <div className="rounded-md border border-gray-200 bg-gray-50 p-2">
                  <div className="font-medium text-gray-800">
                    {t('multiTabs')}
                  </div>
                  <div className="break-all">
                    {t('currentTab')}: {activePath || '/dashboard'}
                  </div>
                  <div className="mt-1">{t('multiTabsHint')}</div>
                </div>
                <button
                  type="button"
                  className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-left hover:bg-gray-50"
                  onClick={() => {
                    closeTab(activePath || '/dashboard');
                    const next =
                      useWorkspaceTabsStore.getState().activePath ||
                      '/dashboard';
                    activateTab(next);
                    router.push(next);
                  }}
                >
                  {t('closeCurrentTab')}
                </button>
              </div>
            </aside>
          ) : null}
        </div>
      </main>
    </div>
  );
}
