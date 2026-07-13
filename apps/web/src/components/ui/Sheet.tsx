'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  widthClassName?: string;
  closeLabel?: string;
}

export function Sheet({
  open,
  title,
  onClose,
  children,
  widthClassName = 'w-[min(680px,95vw)]',
  closeLabel = 'Close panel',
}: SheetProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previousActiveElement = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActiveElement?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/35"
        aria-hidden="true"
        tabIndex={-1}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`absolute right-0 top-0 h-full ${widthClassName} border-l border-slate-200 bg-white shadow-2xl`}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 id={titleId} className="text-base font-semibold text-slate-900">
            {title}
          </h3>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100"
            aria-label={closeLabel}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <div className="h-[calc(100%-57px)] overflow-auto px-5 py-4">{children}</div>
      </aside>
    </div>
  );
}
