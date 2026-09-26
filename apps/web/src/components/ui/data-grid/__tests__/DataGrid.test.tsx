import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnDef } from '@tanstack/react-table';
import { DataGrid } from '../DataGrid';
import { useI18nStore } from '@/lib/i18n';

beforeEach(() => {
  useI18nStore.setState({ language: 'zh-CN' });
});

jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({
    count,
    estimateSize,
    scrollMargin = 0,
  }: {
    count: number;
    estimateSize: () => number;
    scrollMargin?: number;
  }) => {
    const size = estimateSize();
    const items = Array.from({ length: count }, (_, index) => ({
      index,
      key: index,
      start: scrollMargin + index * size,
      size,
      end: scrollMargin + (index + 1) * size,
    }));
    return {
      getVirtualItems: () => items,
      getTotalSize: () => count * size,
    };
  },
}));

type Row = {
  id: string;
  name: string;
};

const columns: ColumnDef<Row, unknown>[] = [
  { id: 'id', accessorKey: 'id', header: '编号' },
  { id: 'name', accessorKey: 'name', header: '名称' },
];

describe('DataGrid column views', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists column visibility for the same business view', async () => {
    const user = userEvent.setup();
    const first = render(
      <DataGrid columns={columns} data={[]} viewId="Product" />,
    );

    await user.click(screen.getByRole('button', { name: '列设置' }));
    await user.click(screen.getByRole('checkbox', { name: '名称' }));

    await waitFor(() => {
      expect(localStorage.getItem('oneerp:data-grid:Product:columns')).toBe(
        JSON.stringify({ name: false }),
      );
    });

    first.unmount();
    render(<DataGrid columns={columns} data={[]} viewId="Product" />);
    await user.click(screen.getByRole('button', { name: '列设置' }));

    expect(screen.getByRole('checkbox', { name: '名称' })).not.toBeChecked();
  });

  it('restores all columns to the default view', async () => {
    localStorage.setItem(
      'oneerp:data-grid:Product:columns',
      JSON.stringify({ name: false }),
    );
    const user = userEvent.setup();
    render(<DataGrid columns={columns} data={[]} viewId="Product" />);

    await user.click(screen.getByRole('button', { name: '列设置' }));
    expect(screen.getByRole('checkbox', { name: '名称' })).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: '恢复默认列' }));

    expect(screen.getByRole('checkbox', { name: '名称' })).toBeChecked();
    await waitFor(() => {
      expect(localStorage.getItem('oneerp:data-grid:Product:columns')).toBe(
        '{}',
      );
    });
  });

  it('falls back to the default view when stored visibility is malformed', async () => {
    localStorage.setItem('oneerp:data-grid:Product:columns', '{not-json');
    const user = userEvent.setup();

    expect(() => {
      render(<DataGrid columns={columns} data={[]} viewId="Product" />);
    }).not.toThrow();

    await user.click(screen.getByRole('button', { name: '列设置' }));
    expect(screen.getByRole('checkbox', { name: '编号' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '名称' })).toBeChecked();
  });

  it('keeps at least one column visible', async () => {
    const user = userEvent.setup();
    render(<DataGrid columns={columns} data={[]} viewId="Product" />);

    await user.click(screen.getByRole('button', { name: '列设置' }));
    await user.click(screen.getByRole('checkbox', { name: '名称' }));

    expect(screen.getByRole('checkbox', { name: '编号' })).toBeDisabled();
  });
});

describe('DataGrid interactions', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps the sortable header in the same virtualized scroll region as its rows', async () => {
    const user = userEvent.setup();
    render(
      <DataGrid
        columns={columns}
        data={[{ id: 'product-1', name: 'Widget' }, { id: 'product-2', name: 'Gadget' }]}
        height={120}
      />,
    );

    const table = screen.getByRole('table');
    const header = screen.getByRole('columnheader', { name: '名称' });
    const cell = await screen.findByRole('cell', { name: 'Widget' });
    const contentWrapper = header.closest('[role="rowgroup"]');

    expect(table).toContainElement(header);
    expect(table).toContainElement(cell);
    expect(table).toHaveClass('overflow-auto');
    expect(header.parentElement).toHaveClass('sticky', 'top-0');
    expect(contentWrapper).not.toBeNull();
    expect(contentWrapper).toContainElement(cell);
    expect(contentWrapper).toHaveStyle({ height: '120px', position: 'relative' });
    expect(cell.closest('[role="row"]')).toHaveStyle({ transform: 'translateY(0px)' });
    expect(screen.getByRole('cell', { name: 'Gadget' }).closest('[role="row"]')).toHaveStyle({ transform: 'translateY(40px)' });
    expect(cell.closest('[role="row"]')?.parentElement).toHaveStyle({ top: '40px' });

    await user.dblClick(cell);
    expect(screen.queryByDisplayValue('Widget')).not.toBeInTheDocument();
  });

  it('preserves callback-backed editing and accessible row selection', async () => {
    const user = userEvent.setup();
    const onCellUpdate = jest.fn();
    const onRowClick = jest.fn();
    const onSelectionChange = jest.fn();
    render(
      <DataGrid
        columns={columns}
        data={[{ id: 'product-1', name: 'Widget' }]}
        onCellUpdate={onCellUpdate}
        onRowClick={onRowClick}
        enableRowSelection
        onSelectionChange={onSelectionChange}
      />,
    );

    await user.dblClick(await screen.findByRole('cell', { name: 'Widget' }));
    const editor = screen.getByDisplayValue('Widget');
    await user.clear(editor);
    await user.type(editor, 'Updated');
    await user.keyboard('{Enter}');
    expect(onCellUpdate).toHaveBeenCalledWith('product-1', 'name', 'Updated');

    const rowCheckbox = screen.getByRole('checkbox', { name: '选择行 1' });
    expect(screen.getByRole('checkbox', { name: '选择当前页所有行' })).toBeInTheDocument();
    onRowClick.mockClear();
    await user.click(rowCheckbox);
    expect(onRowClick).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(onSelectionChange).toHaveBeenLastCalledWith(['product-1']);
    });
  });

  it('hides an open editor if its update callback is removed', async () => {
    const user = userEvent.setup();
    const onCellUpdate = jest.fn();
    const props = {
      columns,
      data: [{ id: 'product-1', name: 'Widget' }],
    };
    const { rerender } = render(<DataGrid {...props} onCellUpdate={onCellUpdate} />);

    await user.dblClick(await screen.findByRole('cell', { name: 'Widget' }));
    expect(screen.getByDisplayValue('Widget')).toBeInTheDocument();

    rerender(<DataGrid {...props} />);
    expect(screen.queryByDisplayValue('Widget')).not.toBeInTheDocument();
    expect(onCellUpdate).not.toHaveBeenCalled();
  });

  it('updates shared header and row widths when column definitions change', () => {
    const data = [{ id: 'product-1', name: 'Widget' }];
    const { rerender } = render(<DataGrid columns={columns} data={data} />);
    const resized = columns.map((column) => ({ ...column, size: 240 }));
    rerender(<DataGrid columns={resized} data={data} />);
    expect(screen.getByRole('columnheader', { name: '名称' }).parentElement).toHaveStyle({ gridTemplateColumns: '240px 240px', width: '480px' });
    expect(screen.getByRole('cell', { name: 'Widget' }).closest('[role="row"]')).toHaveStyle({ gridTemplateColumns: '240px 240px' });
  });

  it('localizes selection labels in English', () => {
    useI18nStore.setState({ language: 'en-US' });
    render(<DataGrid columns={columns} data={[{ id: 'product-1', name: 'Widget' }]} enableRowSelection />);
    expect(screen.getByRole('checkbox', { name: 'Select row 1' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select all rows on this page' })).toBeInTheDocument();
  });
});
