import type { LucideIcon } from 'lucide-react';
import { Skeleton } from './Skeleton';

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  tone?: 'blue' | 'indigo' | 'green' | 'red' | 'slate';
  loading?: boolean;
}

const toneClasses = {
  blue: 'bg-blue-50 text-blue-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  green: 'bg-green-50 text-green-600',
  red: 'bg-red-50 text-red-600',
  slate: 'bg-slate-100 text-slate-600',
};

export function StatCard({ icon: Icon, label, value, tone = 'slate', loading = false }: StatCardProps) {
  return (
    <div className="flex min-h-28 items-center rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className={`mr-4 rounded-lg p-3 ${toneClasses[tone]}`}>
        <Icon className="h-6 w-6" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        {loading ? (
          <Skeleton className="mt-2 h-8 w-24" />
        ) : (
          <p className="mt-1 truncate text-2xl font-bold text-gray-900">{value}</p>
        )}
      </div>
    </div>
  );
}
