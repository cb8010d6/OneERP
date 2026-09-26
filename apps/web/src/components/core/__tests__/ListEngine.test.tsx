import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UiSchema } from '@/lib/ui-schema';
import { ListEngine } from '../ListEngine';
import { useI18nStore } from '@/lib/i18n';

// jsdom has no viewport measurements. Keep row positions faithful to the
// virtualizer's scrollMargin contract; browser scrolling is separate QA.
jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize, scrollMargin = 0 }: {
    count: number;
    estimateSize: () => number;
    scrollMargin?: number;
  }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      index,
      key: index,
      start: scrollMargin + index * estimateSize(),
      size: estimateSize(),
      end: scrollMargin + (index + 1) * estimateSize(),
    })),
    getTotalSize: () => count * estimateSize(),
  }),
}));

const schema: UiSchema = {
  model: 'Product',
  label: '产品',
  fields: [
    { name: 'id', label: '编号', type: 'string' },
    { name: 'name', label: '名称', type: 'string' },
  ],
  views: {
    form: { fields: ['name'] },
    list: { columns: ['id', 'name'], searchFields: ['name'] },
  },
};

describe('ListEngine column view', () => {
  beforeEach(() => {
    localStorage.clear();
    useI18nStore.setState({ language: 'zh-CN' });
  });

  it('stores column visibility under the schema model', async () => {
    const user = userEvent.setup();
    render(
      <ListEngine
        schema={schema}
        data={[{ id: 'product-1', name: '产品 A' }]}
      />,
    );

    await user.click(screen.getByRole('button', { name: '列设置' }));
    await user.click(screen.getByRole('checkbox', { name: '名称' }));

    await waitFor(() => {
      expect(localStorage.getItem('oneerp:data-grid:Product:columns')).toBe(
        JSON.stringify({ name: false }),
      );
    });
  });

  it('labels list search and announces the direction of applied local sorting', async () => {
    const user = userEvent.setup();
    render(
      <ListEngine
        schema={schema}
        data={[
          { id: 'product-b', name: 'Beta' },
          { id: 'product-a', name: 'Alpha' },
        ]}
      />,
    );

    expect(screen.getByRole('textbox', { name: '搜索列表' })).toBeInTheDocument();
    const ascendingSort = screen.getByRole('button', {
      name: '按 名称 升序排序',
    });
    await user.click(ascendingSort);

    const nameHeader = screen.getByRole('columnheader', { name: '名称' });
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
    await waitFor(() => {
      const cells = screen.getAllByRole('cell');
      expect(cells[0]).toHaveTextContent('product-a');
    });
  });

  it('only exposes sort controls when list sorting is actually wired', async () => {
    const user = userEvent.setup();
    const onSortChange = jest.fn();
    const { rerender } = render(
      <ListEngine
        schema={schema}
        data={[{ id: 'product-b', name: 'Beta' }]}
        serverSearch
      />,
    );
    expect(
      screen.queryByRole('button', { name: /按 名称/ }),
    ).not.toBeInTheDocument();

    rerender(
      <ListEngine
        schema={schema}
        data={[{ id: 'product-b', name: 'Beta' }]}
        serverSearch
        onSortChange={onSortChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: '按 名称 升序排序' }));
    expect(onSortChange).toHaveBeenCalledWith('name', 'asc');
    expect(
      screen.getByRole('columnheader', { name: '名称' }),
    ).toHaveAttribute('aria-sort', 'ascending');
  });
});
