import {
  nextDocumentTimestamp,
  resetDocumentTimestampForTest,
} from './document-timestamp';

describe('document timestamp helper', () => {
  const realDateNow = Date.now;

  afterEach(() => {
    Date.now = realDateNow;
    resetDocumentTimestampForTest();
  });

  it('returns the current timestamp for the first call', () => {
    Date.now = jest.fn(() => 1700000000000);

    expect(nextDocumentTimestamp()).toBe(1700000000000);
  });

  it('keeps timestamps monotonic within the same process', () => {
    Date.now = jest.fn(() => 1700000000000);

    expect(nextDocumentTimestamp()).toBe(1700000000000);
    expect(nextDocumentTimestamp()).toBe(1700000000001);
    expect(nextDocumentTimestamp()).toBe(1700000000002);
  });

  it('applies retry offsets without moving backwards', () => {
    Date.now = jest.fn(() => 1700000000000);

    expect(nextDocumentTimestamp(3)).toBe(1700000000003);
    expect(nextDocumentTimestamp(1)).toBe(1700000000004);
  });
});
