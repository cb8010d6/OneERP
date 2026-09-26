import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReasonDialog } from '../ReasonDialog';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const defaultProps = {
  open: true,
  title: '报工冲销',
  description: '填写本次冲销原因。',
  label: '冲销原因',
  confirmLabel: '确认冲销',
  errorFallback: '提交失败，请重试。',
  onClose: jest.fn(),
  onSubmit: jest.fn<Promise<void>, [string]>(),
};

describe('ReasonDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires a non-blank trimmed reason and preserves it for retry after failure', async () => {
    const user = userEvent.setup();
    const onSubmit = jest
      .fn<Promise<void>, [string]>()
      .mockRejectedValueOnce({
        response: { data: { message: '服务暂不可用' } },
      })
      .mockResolvedValueOnce(undefined);
    render(<ReasonDialog {...defaultProps} onSubmit={onSubmit} />);

    const dialog = screen.getByRole('dialog', { name: '报工冲销' });
    const reasonField = screen.getByRole('textbox', { name: '冲销原因' });
    await user.type(reasonField, '   ');
    await user.click(
      screen.getByRole('button', { name: '确认冲销' }),
    );

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('请填写原因。');

    await user.clear(reasonField);
    await user.type(reasonField, '  数量录入错误  ');
    await user.click(screen.getByRole('button', { name: '确认冲销' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('服务暂不可用');
    expect(reasonField).toHaveValue('数量录入错误');
    expect(dialog).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '确认冲销' }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(2);
      expect(onSubmit).toHaveBeenNthCalledWith(1, '数量录入错误');
      expect(onSubmit).toHaveBeenNthCalledWith(2, '数量录入错误');
    });
  });

  it('keeps the sheet mounted and blocks dismissal while a request is pending', async () => {
    const user = userEvent.setup();
    const pending = deferred<void>();
    const onSubmit = jest.fn(() => pending.promise);
    const onClose = jest.fn();
    const { container } = render(
      <div>
        <button type="button">Background action</button>
        <ReasonDialog {...defaultProps} onClose={onClose} onSubmit={onSubmit} />
      </div>,
    );

    await user.type(screen.getByRole('textbox', { name: '冲销原因' }), '录入错误');
    await user.click(screen.getByRole('button', { name: '确认冲销' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: '提交中...' }),
    ).toBeDisabled();

    await user.tab();
    const closeButton = screen.getByRole('button', { name: '关闭' });
    expect(closeButton).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('textbox', { name: '冲销原因' })).toHaveFocus();

    const backgroundAction = screen.getByRole('button', {
      name: 'Background action',
    });
    backgroundAction.focus();
    fireEvent.keyDown(backgroundAction, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    fireEvent.submit(container.querySelector('form')!);
    fireEvent.submit(container.querySelector('form')!);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(container.querySelector('button[aria-hidden="true"]')!);
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '报工冲销' })).toBeInTheDocument();

    await act(async () => {
      pending.resolve(undefined);
      await pending.promise;
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '确认冲销' })).toBeEnabled(),
    );
  });

  it('rejects overlong trimmed reasons before attempting the request', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    render(<ReasonDialog {...defaultProps} onSubmit={onSubmit} />);

    const reasonField = screen.getByRole('textbox', { name: '冲销原因' });
    fireEvent.change(reasonField, { target: { value: 'a'.repeat(1001) } });
    await user.click(screen.getByRole('button', { name: '确认冲销' }));

    expect(screen.getByRole('alert')).toHaveTextContent('不能超过 1000 个字符');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(reasonField).not.toHaveAttribute('readonly');
  });
});
