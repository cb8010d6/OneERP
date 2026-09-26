import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import Pagination from '../Pagination';
import { useI18nStore } from '@/lib/i18n';

beforeEach(() => useI18nStore.setState({ language: 'en-US' }));

it('keeps page bounds and shows localized totals without submitting a form', () => {
  const onPageChange = jest.fn();
  const { rerender } = render(<Pagination page={1} totalPages={3} total={1234} onPageChange={onPageChange} />);
  expect(screen.getByRole('navigation', { name: 'List pagination' })).toBeInTheDocument();
  expect(screen.getByText('1,234 records')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  const next = screen.getByRole('button', { name: 'Next' });
  expect(next).toHaveAttribute('type', 'button');
  fireEvent.click(next);
  expect(onPageChange).toHaveBeenCalledWith(2);
  rerender(<Pagination page={3} totalPages={3} total={1234} onPageChange={onPageChange} />);
  expect(next).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
  expect(onPageChange).toHaveBeenLastCalledWith(2);
});

it('supports Chinese labels and hides an empty result pager', () => {
  useI18nStore.setState({ language: 'zh-CN' });
  const { rerender } = render(<Pagination page={1} totalPages={1} total={1} onPageChange={jest.fn()} />);
  expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
  rerender(<Pagination page={1} totalPages={0} total={0} onPageChange={jest.fn()} />);
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
});
