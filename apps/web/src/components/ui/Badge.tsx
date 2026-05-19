import type { ReactNode } from 'react';

type BadgeVariant = 'draft' | 'pending' | 'active' | 'success' | 'danger';

interface BadgeProps {
  children?: ReactNode;
  status?: string | null;
  variant?: BadgeVariant;
  className?: string;
}

const statusVariantMap: Record<string, BadgeVariant> = {
  DRAFT: 'draft',
  PENDING: 'pending',
  PENDING_APPROVAL: 'pending',
  SUBMITTED: 'active',
  IN_PRODUCTION: 'active',
  PROCESSING: 'active',
  PARTIAL_SHIPPED: 'active',
  SHIPPED: 'success',
  COMPLETED: 'success',
  RECEIVED: 'success',
  POSTED: 'success',
  CANCELLED: 'danger',
  FAILED: 'danger',
  REVERSED: 'danger',
};

export function Badge({ children, status, variant, className = '' }: BadgeProps) {
  const resolvedVariant = variant ?? statusVariantMap[String(status ?? '').toUpperCase()] ?? 'draft';

  return (
    <span className={`erp-badge erp-badge--${resolvedVariant} ${className}`.trim()}>
      {children ?? status ?? '-'}
    </span>
  );
}
