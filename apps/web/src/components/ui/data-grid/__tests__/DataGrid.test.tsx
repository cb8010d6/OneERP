import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnDef } from '@tanstack/react-table';
import { DataGrid } from '../DataGrid';

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
