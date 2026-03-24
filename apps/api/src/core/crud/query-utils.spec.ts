import { BadRequestException } from '@nestjs/common';
import {
  parseJsonParam,
  normalizeSelect,
  parseOrderByParam,
} from './query-utils';

describe('query-utils', () => {
  it('parses json object', () => {
    const value = parseJsonParam<{ name: string }>('{"name":"ACME"}');
    expect(value).toEqual({ name: 'ACME' });
  });

  it('parses comma list when enabled', () => {
    const value = parseJsonParam<string[]>('id,name', { allowCommaList: true });
    expect(value).toEqual(['id', 'name']);
  });

  it('throws on invalid json', () => {
    expect(() => parseJsonParam('{bad')).toThrow(BadRequestException);
  });

  it('normalizes select list', () => {
    const select = normalizeSelect(['id', 'name']);
    expect(select).toEqual({ id: true, name: true });
  });

  it('parses orderBy from short string syntax', () => {
    const orderBy = parseOrderByParam('name:asc,createdAt:desc');
    expect(orderBy).toEqual([{ name: 'asc' }, { createdAt: 'desc' }]);
  });

  it('parses orderBy from json string', () => {
    const orderBy = parseOrderByParam('{"name":"asc"}');
    expect(orderBy).toEqual({ name: 'asc' });
  });
});
