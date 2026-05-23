'use client';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import api from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { UiActionSchema } from '@/lib/ui-schema';
import { Button } from '../ui/Button';
import { Sheet } from '../ui/Sheet';
import { AsyncSelect } from './AsyncSelect';

interface BusinessCorrectionWizardProps {
  open: boolean;
  action: UiActionSchema | null;
  record: Record<string, unknown> | null;
  onClose: () => void;
  onCompleted: () => void | Promise<void>;
}

export function BusinessCorrectionWizard({
  open,
  action,
  record,
  onClose,
  onCompleted,
}: BusinessCorrectionWizardProps) {
  const { t } = useI18n();
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fields = action?.fields ?? [];

  const recordLabel = useMemo(() => {
    if (!record) return '-';
    return String(record.orderNo ?? record.invoiceNo ?? record.name ?? record.id ?? '-');
  }, [record]);

  const updateField = (fieldName: string, value: string) => {
    setForm((current) => ({ ...current, [fieldName]: value }));
    if (error) setError(null);
  };

  const submit = async () => {
    if (!action || !record || submitting) return;

    const missingRequired = fields.find(
      (field) => field.required && !String(form[field.name] ?? '').trim(),
    );
    if (missingRequired) {
      setError(t('correctionWizardReasonRequired'));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const payload = fields.reduce<Record<string, string>>((acc, field) => {
        const value = String(form[field.name] ?? '').trim();
        if (value) acc[field.name] = value;
        return acc;
      }, {});

      await api.request({
        method: action.method.toLowerCase(),
        url: interpolateEndpoint(action.endpoint, record),
        data: payload,
      });
      setForm({});
      await onCompleted();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('correctionWizardFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      open={open}
      title={action?.label ?? t('correctionWizardTitle')}
      onClose={onClose}
      widthClassName="w-[min(640px,96vw)]"
    >
      <div className="space-y-5">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
            <div>
              <p className="text-sm font-semibold text-amber-900">
                {action?.description ?? t('correctionWizardImmutableHint')}
              </p>
              <p className="mt-1 text-xs text-amber-800">
                {t('correctionWizardRecord')}: {recordLabel}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 text-sm md:grid-cols-3">
          {[t('correctionWizardStepReview'), t('correctionWizardStepReason'), t('correctionWizardStepSubmit')].map(
            (label, index) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center gap-2 font-medium text-slate-800">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  {index + 1}. {label}
                </div>
              </div>
            ),
          )}
        </div>

        <div className="space-y-4">
          {fields.map((field) => (
            <div key={field.name} className="space-y-2">
              <label className="text-sm font-medium text-slate-700" htmlFor={`correction-${field.name}`}>
                {field.label}
                {field.required ? <span className="text-rose-500"> *</span> : null}
              </label>
              {field.type === 'reference' && field.reference ? (
                <AsyncSelect
                  id={`correction-${field.name}`}
                  value={form[field.name] ?? ''}
                  reference={field.reference}
                  placeholder={field.placeholder}
                  onChange={(value) => updateField(field.name, value)}
                />
              ) : field.type === 'text' ? (
                <textarea
                  id={`correction-${field.name}`}
                  value={form[field.name] ?? ''}
                  placeholder={field.placeholder}
                  rows={4}
                  onChange={(event) => updateField(field.name, event.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
                />
              ) : (
                <input
                  id={`correction-${field.name}`}
                  value={form[field.name] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(event) => updateField(field.name, event.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
                />
              )}
            </div>
          ))}
        </div>

        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t('commonCancel')}
          </Button>
          <Button variant="danger" onClick={() => void submit()} loading={submitting}>
            {submitting
              ? t('correctionWizardSubmitting')
              : action?.confirmText ?? t('correctionWizardSubmit')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function interpolateEndpoint(endpoint: string, record: Record<string, unknown>) {
  return endpoint.replace(/\{(\w+)\}/g, (_, key: string) =>
    encodeURIComponent(String(record[key] ?? '')),
  );
}
