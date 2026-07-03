import {
  isPrismaUniqueConstraintError,
  withUniqueConstraintRetry,
} from './prisma-unique-retry';

describe('prisma unique retry helpers', () => {
  it('detects P2002 errors for the expected target field', () => {
    expect(
      isPrismaUniqueConstraintError(
        { code: 'P2002', meta: { target: ['invoiceNo'] } },
        ['invoiceNo'],
      ),
    ).toBe(true);
  });

  it('does not retry unrelated unique targets', async () => {
    const error = { code: 'P2002', meta: { target: ['partnerId'] } };
    const operation = jest.fn().mockRejectedValue(error);

    await expect(
      withUniqueConstraintRetry(operation, { targetFields: ['invoiceNo'] }),
    ).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries matching unique conflicts with increasing attempt numbers', async () => {
    const operation = jest
      .fn()
      .mockRejectedValueOnce({ code: 'P2002', meta: { target: 'invoiceNo' } })
      .mockResolvedValueOnce('created');

    await expect(
      withUniqueConstraintRetry(operation, { targetFields: ['invoiceNo'] }),
    ).resolves.toBe('created');
    expect(operation).toHaveBeenNthCalledWith(1, 0);
    expect(operation).toHaveBeenNthCalledWith(2, 1);
  });

  it('stops after maxAttempts', async () => {
    const error = { code: 'P2002', meta: { target: ['invoiceNo'] } };
    const operation = jest.fn().mockRejectedValue(error);

    await expect(
      withUniqueConstraintRetry(operation, {
        targetFields: ['invoiceNo'],
        maxAttempts: 2,
      }),
    ).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
