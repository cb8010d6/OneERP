'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { UiFieldSchema, UiSchema } from '@/lib/ui-schema';
import { fetchResourceList } from '@/lib/dynamic-resource';

interface FormEngineProps {
  schema: UiSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  onSubmit?: () => void;
  readOnly?: boolean;
}

const inputClass =
  'h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-2 focus:ring-gray-100';

export function FormEngine({ schema, value, onChange, onSubmit, readOnly }: FormEngineProps) {
  const [referenceOptions, setReferenceOptions] = useState<
    Record<string, Array<{ label: string; value: string }>>
  >({});

  const fieldMap = useMemo(() => {
    return schema.fields.reduce<Record<string, UiFieldSchema>>((acc, field) => {
      acc[field.name] = field;
      return acc;
    }, {});
  }, [schema.fields]);

  const fieldOrder = schema.views.form?.fields ?? schema.fields.map((field) => field.name);

  const sections = schema.views.form?.sections;

  useEffect(() => {
    const referenceFields = schema.fields.filter((field) => field.type === 'reference' && field.reference?.model);
    if (!referenceFields.length) {
      setReferenceOptions({});
      return;
    }

    let cancelled = false;

    const loadOptions = async () => {
      const next: Record<string, Array<{ label: string; value: string }>> = {};

      for (const field of referenceFields) {
        const model = field.reference?.model;
        if (!model) continue;

        try {
          const list = await fetchResourceList(model, {
            page: 1,
            limit: 200,
          });

          const labelField = field.reference?.labelField ?? 'name';
          const valueField = field.reference?.valueField ?? 'id';

          next[field.name] = (list.data as Record<string, unknown>[])
            .map((item) => ({
              label: String(item[labelField] ?? item[valueField] ?? ''),
              value: String(item[valueField] ?? ''),
            }))
            .filter((item) => item.value);
        } catch {
          next[field.name] = [];
        }
      }

      if (!cancelled) {
        setReferenceOptions(next);
      }
    };

    void loadOptions();

    return () => {
      cancelled = true;
    };
  }, [schema.fields]);

  const renderField = (field: UiFieldSchema) => {
    const rawValue = getNestedValue(value, field.name);
    const fieldValue =
      typeof rawValue === 'string' || typeof rawValue === 'number'
        ? rawValue
        : '';
    const commonProps = {
      id: field.name,
      name: field.name,
      disabled: readOnly,
      className: inputClass,
      value: fieldValue,
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        onChange(setNestedValue(value, field.name, event.target.value)),
      onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        if (event.ctrlKey && event.key === 'Enter') {
          event.preventDefault();
          onSubmit?.();
        }
      },
    };

    if (field.type === 'text') {
      return <textarea {...commonProps} rows={3} className={`${inputClass} py-2`} />;
    }

    if (field.type === 'select') {
      return (
        <select {...commonProps}>
          <option value="">请选择</option>
          {field.options?.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    if (field.type === 'reference') {
      const options = referenceOptions[field.name] ?? [];
      return (
        <select {...commonProps}>
          <option value="">请选择</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    if (field.type === 'boolean') {
      return (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={Boolean(rawValue)}
            disabled={readOnly}
            onChange={(event) => onChange(setNestedValue(value, field.name, event.target.checked))}
            className="h-4 w-4 rounded border-gray-300 text-gray-900"
          />
          {field.label}
        </label>
      );
    }

    const type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
    return <input {...commonProps} type={type} />;
  };

  const renderFieldBlock = (fieldName: string) => {
    const field = fieldMap[fieldName];
    if (!field) return null;

    return (
      <div key={field.name} className="space-y-2">
        {field.type !== 'boolean' && (
          <label htmlFor={field.name} className="text-sm font-medium text-gray-700">
            {field.label}
            {field.required ? <span className="text-rose-500"> *</span> : null}
          </label>
        )}
        {renderField(field)}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {sections?.length
        ? sections.map((section) => (
            <section key={section.title ?? section.fields.join('-')} className="space-y-4">
              {section.title ? <h3 className="text-sm font-semibold text-gray-800">{section.title}</h3> : null}
              <div className="grid gap-4 md:grid-cols-2">{section.fields.map(renderFieldBlock)}</div>
            </section>
          ))
        : (
            <div className="grid gap-4 md:grid-cols-2">{fieldOrder.map(renderFieldBlock)}</div>
          )}
    </div>
  );
}

function getNestedValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object') {
      return undefined;
    }
    return (acc as Record<string, unknown>)[key];
  }, source);
}

function setNestedValue(
  source: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const keys = path.split('.');
  const next = { ...source };
  let cursor: Record<string, unknown> = next;

  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const isLeaf = i === keys.length - 1;
    if (isLeaf) {
      cursor[key] = value;
      continue;
    }

    const current = cursor[key];
    const child =
      current && typeof current === 'object' && !Array.isArray(current)
        ? { ...(current as Record<string, unknown>) }
        : {};

    cursor[key] = child;
    cursor = child;
  }

  return next;
}
