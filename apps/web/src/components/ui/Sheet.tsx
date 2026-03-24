'use client';

import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  widthClassName?: string;
}

export function Sheet({ open, title, onClose, children, widthClassName = 'w-[min(680px,95vw)]' }: SheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/35"
        aria-label="Close panel"
      />

      <aside className={`absolute right-0 top-0 h-full ${widthClassName} border-l border-slate-200 bg-white shadow-2xl`}>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="h-[calc(100%-57px)] overflow-auto px-5 py-4">{children}</div>
      </aside>
    </div>
  );
}
