'use client';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ page, totalPages, total, onPageChange }: PaginationProps) {
  if (total === 0) return null;
  
  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200">
      <p className="text-sm text-gray-500">共 {total} 条记录</p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50"
        >
          上一页
        </button>
        <span className="text-sm text-gray-700">{page} / {totalPages > 0 ? totalPages : 1}</span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50"
        >
          下一页
        </button>
      </div>
    </div>
  );
}
