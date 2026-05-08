'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { useAuthStore } from '../store/authStore';

interface PermissionsContextValue {
  permissions: string[];
  hasPermission: (perm: string) => boolean;
  hasAnyPermission: (perms: string[]) => boolean;
}

const PermissionsContext = createContext<PermissionsContextValue>({
  permissions: [],
  hasPermission: () => false,
  hasAnyPermission: () => false,
});

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const { currentCompanyId, companies } = useAuthStore();

  const permissions = useMemo(() => {
    if (!currentCompanyId) return [];
    const company = companies.find((c) => c.id === currentCompanyId);
    if (!company) return [];

    if (typeof company.role === 'object' && company.role !== null && Array.isArray(company.role.permissions)) {
      return company.role.permissions;
    }
    return [];
  }, [currentCompanyId, companies]);

  const value = useMemo(() => {
    const hasPermission = (perm: string) => {
      // Allow global ADMIN bypass
      if (permissions.includes('*') || permissions.includes('admin')) {
        return true;
      }
      return permissions.includes(perm);
    };

    const hasAnyPermission = (perms: string[]) => {
      if (perms.length === 0) return true;
      return perms.some(hasPermission);
    };

    return { permissions, hasPermission, hasAnyPermission };
  }, [permissions]);

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions() {
  return useContext(PermissionsContext);
}

/**
 * A helper component that conditionally renders its children
 * based on whether the current user has ANY of the required permissions.
 */
export function RequirePermission({
  perms,
  children,
  fallback = null,
}: {
  perms: string[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { hasAnyPermission } = usePermissions();

  if (hasAnyPermission(perms)) {
    return <>{children}</>;
  }
  return <>{fallback}</>;
}
