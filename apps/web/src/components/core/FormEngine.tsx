'use client';

import { useMemo } from 'react';
import type { ChangeEvent } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { UiFieldSchema, UiSchema } from '@/lib/ui-schema';
import { AsyncSelect } from './AsyncSelect';

interface FormEngineProps {
  schema: UiSchema;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  onSubmit?: () => void;
  readOnly?: boolean;
  validationErrors?: Record<string, string>;
}

const inputClass =
  'h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-gray-300 focus:ring-2 focus:ring-gray-100';

type FormField = UiFieldSchema & { readOnly?: boolean };

export function FormEngine({
  schema,
  value,
  onChange,
  onSubmit,
  readOnly,
  validationErrors = {},
}: FormEngineProps) {
  const fieldMap = useMemo(() => {
    return schema.fields.reduce<Record<string, UiFieldSchema>>((acc, field) => {
      acc[field.name] = field;
      return acc;
    }, {});
  }, [schema.fields]);

  const fieldOrder = schema.views.form?.fields ?? schema.fields.map((field) => field.name);

  const sections = schema.views.form?.sections;

  const renderField = (field: FormField) => {
    const rawValue = getNestedValue(value, field.name);
    const fieldValue =
      typeof rawValue === 'string' || typeof rawValue === 'number'
        ? rawValue
        : '';
    
    const isReadOnly = field.readOnly ?? readOnly;

    const commonProps = {
      id: field.name,
      name: field.name,
      disabled: isReadOnly,
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
      const reference = field.reference;
      if (!reference?.model) {
        return <input {...commonProps} type="text" />;
      }

      return (
        <AsyncSelect
          id={field.name}
          value={String(rawValue ?? '')}
          reference={reference}
          disabled={isReadOnly}
          className={inputClass}
          placeholder={`请选择${field.label}`}
          onSubmit={onSubmit}
          onChange={(nextValue) => onChange(setNestedValue(value, field.name, nextValue))}
        />
      );
    }

    if (field.type === 'boolean') {
      return (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={Boolean(rawValue)}
            disabled={isReadOnly}
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

    if (field.hidden_depends_on && evaluateFormCondition(field.hidden_depends_on, value)) {
      return null;
    }

    const isReadOnly =
      Boolean(readOnly) ||
      Boolean(field.read_only_depends_on && evaluateFormCondition(field.read_only_depends_on, value));
    const error = validationErrors[field.name];

    return (
      <div key={field.name} className="space-y-2">
        {field.type !== 'boolean' && (
          <label htmlFor={field.name} className="text-sm font-medium text-gray-700">
            {field.label}
            {field.required ? <span className="text-rose-500"> *</span> : null}
          </label>
        )}
        {renderField({ ...field, readOnly: isReadOnly })}
        {error ? <p className="text-xs text-rose-600">{error}</p> : null}
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

export function validateFormValue(
  schema: UiSchema,
  value: Record<string, unknown>,
  requiredMessage: (label: string) => string = (label) => `${label}为必填项`,
) {
  return schema.fields.reduce<Record<string, string>>((errors, field) => {
    const hidden = field.hidden_depends_on
      ? evaluateFormCondition(field.hidden_depends_on, value)
      : false;

    if (hidden || !field.required) {
      return errors;
    }

    if (isEmptyRequiredValue(getNestedValue(value, field.name))) {
      errors[field.name] = requiredMessage(field.label);
    }
    return errors;
  }, {});
}

export function evaluateFormCondition(condition: string | undefined, doc: Record<string, unknown>) {
  if (!condition) return false;

  const expression = condition.startsWith('eval:')
    ? condition.slice('eval:'.length).trim()
    : condition.trim();

  if (!expression) return false;

  try {
    return evaluateBooleanExpression(expression, doc);
  } catch (error) {
    console.warn('Unsupported form condition:', condition, error);
    return false;
  }
}

function evaluateBooleanExpression(expression: string, doc: Record<string, unknown>): boolean {
  const orParts = splitExpression(expression, '||');
  return orParts.some((orPart) => {
    const andParts = splitExpression(orPart, '&&');
    return andParts.every((part) => evaluateConditionAtom(part, doc));
  });
}

function splitExpression(expression: string, operator: '&&' | '||') {
  const parts: string[] = [];
  let quote: '"' | "'" | null = null;
  let start = 0;

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if ((char === '"' || char === "'") && expression[index - 1] !== '\\') {
      quote = quote === char ? null : quote ?? char;
      continue;
    }

    if (!quote && expression.slice(index, index + operator.length) === operator) {
      parts.push(expression.slice(start, index).trim());
      start = index + operator.length;
      index += operator.length - 1;
    }
  }

  parts.push(expression.slice(start).trim());
  return parts.filter(Boolean);
}

function evaluateConditionAtom(atom: string, doc: Record<string, unknown>): boolean {
  const normalized = stripOuterParentheses(atom.trim());
  if (!normalized) return false;
  if (normalized.startsWith('!')) {
    return !evaluateConditionAtom(normalized.slice(1), doc);
  }

  const comparison = normalized.match(
    /^doc\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/,
  );

  if (comparison) {
    const [, path, operator, rawRight] = comparison;
    const left = getNestedValue(doc, path);
    const right = parseConditionLiteral(rawRight.trim());
    return compareConditionValues(left, right, operator);
  }

  const truthyPath = normalized.match(/^doc\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/);
  if (truthyPath) {
    return Boolean(getNestedValue(doc, truthyPath[1]));
  }

  throw new Error(`Unsupported expression atom: ${atom}`);
}

function stripOuterParentheses(input: string): string {
  let output = input;
  while (output.startsWith('(') && output.endsWith(')')) {
    output = output.slice(1, -1).trim();
  }
  return output;
}

function parseConditionLiteral(input: string): unknown {
  const quoted = input.match(/^(['"])(.*)\1$/);
  if (quoted) {
    return quoted[2].replace(/\\(['"])/g, '$1');
  }
  if (input === 'true') return true;
  if (input === 'false') return false;
  if (input === 'null') return null;
  if (input === 'undefined') return undefined;
  if (/^-?\d+(\.\d+)?$/.test(input)) return Number(input);
  throw new Error(`Unsupported literal: ${input}`);
}

function compareConditionValues(left: unknown, right: unknown, operator: string) {
  if (operator === '===' || operator === '==') {
    return String(left ?? '') === String(right ?? '');
  }
  if (operator === '!==' || operator === '!=') {
    return String(left ?? '') !== String(right ?? '');
  }

  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
    return false;
  }

  if (operator === '>=') return leftNumber >= rightNumber;
  if (operator === '<=') return leftNumber <= rightNumber;
  if (operator === '>') return leftNumber > rightNumber;
  if (operator === '<') return leftNumber < rightNumber;
  return false;
}

function isEmptyRequiredValue(value: unknown) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
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
