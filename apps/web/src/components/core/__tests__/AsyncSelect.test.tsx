import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AsyncSelect } from '../AsyncSelect';

const mockFetchResourceList = jest.fn();

jest.mock('@/lib/dynamic-resource', () => ({
  fetchResourceList: (...args: unknown[]) => mockFetchResourceList(...args),
}));

describe('AsyncSelect', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('debounces search and renders rich option labels', async () => {
    mockFetchResourceList.mockImplementation(async (_modelName: string, params: { search?: string; filter?: Record<string, unknown> }) => {
      if (params.filter?.id === 'p1') {
        return {
          data: [{ id: 'p1', sku: 'SKU-001', name: 'Apple Phone', stock: 50 }],
          total: 1,
          page: 1,
          limit: 1,
          totalPages: 1,
        };
      }

      if (params.search === 'apple') {
        return {
          data: [{ id: 'p1', sku: 'SKU-001', name: 'Apple Phone', stock: 50 }],
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        };
      }

      return {
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      };
    });

    const handleChange = jest.fn();

    render(
      <AsyncSelect
        id="productId"
        value=""
        reference={{ model: 'product', labelField: 'name', valueField: 'id' }}
        onChange={handleChange}
        placeholder="请选择产品"
        className="w-full"
      />,
    );

    const input = screen.getByPlaceholderText('请选择产品');
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: 'apple' } });

    await act(async () => {
      jest.advanceTimersByTime(350);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockFetchResourceList).toHaveBeenCalledWith('product', expect.objectContaining({ search: 'apple', page: 1, limit: 20 }));
    });

    await waitFor(() => {
      expect(screen.getByText('[SKU-001] Apple Phone')).toBeInTheDocument();
      expect(screen.getByText('Stock: 50')).toBeInTheDocument();
    });

    fireEvent.mouseDown(screen.getByRole('button', { name: /Apple Phone/ }));

    expect(handleChange).toHaveBeenCalledWith('p1');
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('[SKU-001] Apple Phone');
  });
});