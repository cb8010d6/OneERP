let lastDocumentTimestamp = 0;

export function nextDocumentTimestamp(offset = 0) {
  const candidate = Date.now() + Math.max(0, offset);
  if (candidate <= lastDocumentTimestamp) {
    lastDocumentTimestamp += 1;
  } else {
    lastDocumentTimestamp = candidate;
  }
  return lastDocumentTimestamp;
}

export function resetDocumentTimestampForTest() {
  lastDocumentTimestamp = 0;
}
