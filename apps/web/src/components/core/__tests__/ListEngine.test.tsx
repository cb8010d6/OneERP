import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UiSchema } from '@/lib/ui-schema';
import { ListEngine } from '../ListEngine';

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
});
