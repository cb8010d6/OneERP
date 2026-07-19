import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sheet } from '../Sheet';

describe('Sheet', () => {
  it('exposes modal semantics and closes with Escape', async () => {
    const onClose = jest.fn();
    render(
      <Sheet open title="编辑客户需求" onClose={onClose} closeLabel="关闭面板">
        <button type="button">保存</button>
      </Sheet>,
    );

    expect(screen.getByRole('dialog', { name: '编辑客户需求' })).toHaveAttribute(
      'aria-modal',
      'true',
    );
    expect(screen.getByRole('button', { name: '关闭面板' })).toBeVisible();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('locks background scrolling and restores focus after closing', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <div>
        <button type="button">打开面板</button>
        <Sheet open={false} title="编辑" onClose={() => undefined}>
          内容
        </Sheet>
      </div>,
    );
    const trigger = screen.getByRole('button', { name: '打开面板' });
    await user.click(trigger);

    rerender(
      <div>
        <button type="button">打开面板</button>
        <Sheet open title="编辑" onClose={() => undefined} closeLabel="关闭面板">
          内容
        </Sheet>
      </div>,
    );

    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByRole('button', { name: '关闭面板' })).toHaveFocus();

    rerender(
      <div>
        <button type="button">打开面板</button>
        <Sheet open={false} title="编辑" onClose={() => undefined}>
          内容
        </Sheet>
      </div>,
    );

    expect(document.body.style.overflow).toBe('');
    expect(screen.getByRole('button', { name: '打开面板' })).toHaveFocus();
  });
});
