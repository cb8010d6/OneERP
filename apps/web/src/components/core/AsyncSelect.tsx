'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { UiFieldReference } from '@/lib/ui-schema';
import { fetchResourceList } from '@/lib/dynamic-resource';

type ResourceRecord = Record<string, unknown>;

interface AsyncSelectOption {
  value: string;
  label: string;
  meta?: string;
}

interface AsyncSelectProps {
  id: string;
  value: string;
  reference: UiFieldReference;
  onChange: (nextValue: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const DEBOUNCE_MS = 300;
const PAGE_SIZE = 20;

export function AsyncSelect({
  id,
  value,
  reference,
  onChange,
  onSubmit,
  placeholder = '请选择',
  className = '',
  disabled,
}: AsyncSelectProps) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<AsyncSelectOption[]>([]);
  const [selectedOption, setSelectedOption] = useState<AsyncSelectOption | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const blurTimerRef = useRef<number | null>(null);
  const requestSeqRef = useRef(0);

  const modelName = reference.model;
  const labelField = reference.labelField ?? 'name';
  const valueField = reference.valueField ?? 'id';

  const inputPlaceholder = useMemo(() => {
    return placeholder || `搜索${labelField}`;
  }, [labelField, placeholder]);

  useEffect(() => {
    if (!value) {
      setSelectedOption(null);
      setQuery('');
      return;
    }

    let cancelled = false;
    const loadSelectedLabel = async () => {
      try {
        const response = await fetchResourceList(modelName, {
          page: 1,
          limit: 1,
          filter: { [valueField]: value },
        });

        const record = (response.data?.[0] as ResourceRecord | undefined) ?? undefined;
        if (!record || cancelled) {
          return;
        }

        const option = formatResourceOption(record, labelField, valueField);
        setSelectedOption(option);
        setQuery(option.label);
      } catch {
        if (!cancelled) {
          setSelectedOption({ value, label: value });
          setQuery(value);
        }
      }
    };

    void loadSelectedLabel();

    return () => {
      cancelled = true;
    };
  }, [labelField, modelName, value, valueField]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const trimmed = query.trim();
    const seq = ++requestSeqRef.current;
    setIsLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetchResourceList(modelName, {
          page: 1,
          limit: PAGE_SIZE,
          search: trimmed || undefined,
        });

        if (requestSeqRef.current !== seq) {
          return;
        }

        const mapped = (response.data as ResourceRecord[]).map((record) =>
          formatResourceOption(record, labelField, valueField),
        );
        setOptions(mapped);
        setActiveIndex(0);
      } catch {
        if (requestSeqRef.current === seq) {
          setOptions([]);
        }
      } finally {
        if (requestSeqRef.current === seq) {
          setIsLoading(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, labelField, modelName, query, valueField]);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) {
        window.clearTimeout(blurTimerRef.current);
      }
    };
  }, []);

  const commitSelection = (option: AsyncSelectOption) => {
    setSelectedOption(option);
    setQuery(option.label);
    setOptions([option]);
    setIsOpen(false);
    setActiveIndex(0);
    onChange(option.value);
  };

  const handleFocus = () => {
    if (disabled) {
      return;
    }

    if (blurTimerRef.current) {
      window.clearTimeout(blurTimerRef.current);
    }
    setIsOpen(true);
  };

  const handleBlur = () => {
    blurTimerRef.current = window.setTimeout(() => {
      setIsOpen(false);
      setQuery(selectedOption?.label ?? '');
    }, 150);
  };

  const handleInputChange = (nextQuery: string) => {
    setQuery(nextQuery);
    setIsOpen(true);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      if (isOpen && options[activeIndex]) {
        event.preventDefault();
        commitSelection(options[activeIndex]);
        return;
      }

      onSubmit?.();
      return;
    }

    if (!isOpen || !options.length) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, options.length - 1));
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
      setQuery(selectedOption?.label ?? '');
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <input
        id={id}
        name={id}
        type="text"
        autoComplete="off"
        disabled={disabled}
        value={query}
        placeholder={inputPlaceholder}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={(event) => handleInputChange(event.target.value)}
        onKeyDown={handleKeyDown}
        className={className}
      />

      {isOpen && !disabled ? (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg shadow-gray-200/60">
          <div className="max-h-72 overflow-auto p-1">
            {isLoading ? (
              <div className="px-3 py-2 text-sm text-gray-500">加载中...</div>
            ) : options.length ? (
              options.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  className={`block w-full rounded-md px-3 py-2 text-left transition ${index === activeIndex ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commitSelection(option);
                  }}
                >
                  <div className="text-sm font-medium text-gray-900">{option.label}</div>
                  {option.meta ? <div className="mt-0.5 text-xs text-gray-500">{option.meta}</div> : null}
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-gray-500">
                {query.trim() ? '未找到匹配项' : '请输入关键词搜索'}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatResourceOption(
  record: ResourceRecord,
  labelField: string,
  valueField: string,
): AsyncSelectOption {
  const value = safeString(record[valueField]) || safeString(record.id) || '';
  const rawLabel =
    safeString(record[labelField]) ||
    safeString(record.name) ||
    safeString(record.title) ||
    safeString(record.sku) ||
    safeString(record.code) ||
    value ||
    '未命名';

  const code = safeString(record.sku) || safeString(record.code) || safeString(record.barcode);
  const label = code && !rawLabel.includes(code) ? `[${code}] ${rawLabel}` : rawLabel;

  const stockValue = resolveStockValue(record);
  const metaParts: string[] = [];
  if (stockValue !== null) {
    const unit = safeString(record.unit) || safeString(record.uom);
    metaParts.push(`Stock: ${stockValue}${unit ? ` ${unit}` : ''}`);
  } else {
    const contact = safeString(record.contact) || safeString(record.phone) || safeString(record.email);
    if (contact) {
      metaParts.push(`Contact: ${contact}`);
    }
  }

  return {
    value,
    label,
    meta: metaParts.join(' · '),
  };
}

function resolveStockValue(record: ResourceRecord): number | null {
  const candidates = ['stock', 'stockQty', 'availableStock', 'availableQty', 'quantity', 'qty', 'onHand', 'balance'];
  for (const key of candidates) {
    const value = record[key];
    if (value === undefined || value === null || value === '') {
      continue;
    }

    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
}

function safeString(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  return typeof value === 'string' ? value : String(value);
}