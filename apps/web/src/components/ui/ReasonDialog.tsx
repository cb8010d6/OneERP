'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '@/lib/i18n';
import { Button } from './Button';
import { Sheet } from './Sheet';

interface ReasonDialogProps {
  open: boolean;
  title: string;
  description: string;
  label: string;
  confirmLabel: string;
  errorFallback: string;
  initialReason?: string;
  reasonLocked?: boolean;
  lockedReasonHint?: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}

function getRequestMessage(error: unknown) {
  if (error && typeof error === 'object' && 'response' in error) {
    const message = (
      error as { response?: { data?: { message?: unknown } } }
    ).response?.data?.message;
    if (typeof message === 'string' && message.trim()) return message;
    if (Array.isArray(message)) {
      const messages = message.filter(
        (item): item is string => typeof item === 'string' && Boolean(item.trim()),
      );
      if (messages.length) return messages.join(' ');
    }
  }

  return error instanceof Error && error.message.trim()
    ? error.message
    : undefined;
}

export function ReasonDialog({
  open,
  title,
  description,
  label,
  confirmLabel,
  errorFallback,
  initialReason = '',
  reasonLocked = false,
  lockedReasonHint,
  onClose,
  onSubmit,
}: ReasonDialogProps) {
  const { t } = useI18n();
  const reasonId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const [reason, setReason] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const submittingRef = useRef(false);
  const initialReasonRef = useRef(initialReason);

  useEffect(() => {
    initialReasonRef.current = initialReason;
  }, [initialReason]);

  useEffect(() => {
    if (!open) return;
    setReason(initialReasonRef.current);
    setValidationError(null);
    setRequestError(null);
    setSubmitting(false);
    submittingRef.current = false;
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const containTabFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const dialog = formRef.current?.closest('[role="dialog"]');
      if (!dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (element) =>
          element.tabIndex >= 0 && element.getAttribute('aria-hidden') !== 'true',
      );
      if (!focusable.length) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      const activeIsFocusable = focusable.includes(
        activeElement as HTMLElement,
      );
      if (!dialog.contains(activeElement) || !activeIsFocusable) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', containTabFocus);
    return () => document.removeEventListener('keydown', containTabFocus);
  }, [open]);

  const closeWhenIdle = () => {
    if (!submittingRef.current) onClose();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setValidationError(t('reasonDialogRequired'));
      setRequestError(null);
      return;
    }
    if (trimmedReason.length > 1000) {
      setValidationError(t('reasonDialogTooLong'));
      setRequestError(null);
      return;
    }

    setReason(trimmedReason);
    submittingRef.current = true;
    setSubmitting(true);
    setValidationError(null);
    setRequestError(null);
    try {
      await onSubmit(trimmedReason);
    } catch (error) {
      setRequestError(getRequestMessage(error) ?? errorFallback);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const error = validationError ?? requestError;

  return (
    <Sheet
      open={open}
      title={title}
      onClose={closeWhenIdle}
      closeLabel={t('commonClose')}
      widthClassName="w-[min(520px,95vw)]"
    >
      <form
        ref={formRef}
        noValidate
        onSubmit={(event) => void submit(event)}
        className="space-y-5"
      >
        <div className="space-y-2">
          <p id={descriptionId} className="text-sm text-slate-600">
            {description}
          </p>
          <label
            htmlFor={reasonId}
            className="block text-sm font-medium text-slate-700"
          >
            {label}
            <span className="ml-1 text-rose-600" aria-hidden="true">
              *
            </span>
          </label>
          <textarea
            id={reasonId}
            required
            aria-required="true"
            aria-invalid={Boolean(error)}
            aria-describedby={
              error ? `${descriptionId} ${errorId}` : descriptionId
            }
            maxLength={1000}
            rows={4}
            value={reason}
            readOnly={submitting || reasonLocked}
            onChange={(event) => {
              setReason(event.target.value);
              setValidationError(null);
              setRequestError(null);
            }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
          {reasonLocked && lockedReasonHint ? (
            <p className="text-xs text-amber-700" role="note">
              {lockedReasonHint}
            </p>
          ) : null}
          {error ? (
            <p
              id={errorId}
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button
            variant="secondary"
            onClick={closeWhenIdle}
            disabled={submitting}
          >
            {t('commonCancel')}
          </Button>
          <Button type="submit" variant="danger" loading={submitting}>
            {submitting ? t('reasonDialogSubmitting') : confirmLabel}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
