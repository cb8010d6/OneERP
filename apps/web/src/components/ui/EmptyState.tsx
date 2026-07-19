import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, icon, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center ${className}`.trim()}>
      <div className="mb-3 rounded-full bg-white p-3 text-slate-400 shadow-sm">
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
