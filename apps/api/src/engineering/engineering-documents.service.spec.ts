import { BadRequestException, ConflictException } from '@nestjs/common';
import { EngineeringDocumentsService } from './engineering-documents.service';

describe('EngineeringDocumentsService', () => {
  type CreateDocumentCall = {
    data: Record<string, unknown> & {
      revisions: { create: Record<string, unknown> };
    };
  };
  const tx = {
    fileRecord: { findFirst: jest.fn() },
    product: { findFirst: jest.fn() },
    order: { findFirst: jest.fn() },
    documentSequence: { upsert: jest.fn() },
    engineeringDocument: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    engineeringDocumentRevision: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(
      async (operation: (client: typeof tx) => Promise<unknown>) =>
        operation(tx),
    ),
  };
  let service: EngineeringDocumentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EngineeringDocumentsService(prisma as never);
    tx.fileRecord.findFirst.mockResolvedValue({
      id: 'file-1',
      companyId: 'company-1',
      checksumSha256: 'a'.repeat(64),
      fileName: 'drawing.pdf',
      mimeType: 'application/pdf',
    });
    tx.product.findFirst.mockResolvedValue({ id: 'product-1', sku: 'P-1001' });
    tx.order.findFirst.mockResolvedValue({ id: 'order-1', orderNo: 'ORD-1' });
    tx.documentSequence.upsert.mockResolvedValue({ lastValue: 1 });
    tx.engineeringDocument.create.mockImplementation(
      ({ data }: CreateDocumentCall) => ({
        id: 'document-1',
        ...data,
        revisions: [{ id: 'revision-1', ...data.revisions.create }],
      }),
    );
    tx.auditLog.create.mockResolvedValue({ id: 'audit-1' });
    tx.engineeringDocument.updateMany.mockResolvedValue({ count: 1 });
  });

  it('creates a document with an immutable draft revision and checksum', async () => {
    const result = await service.createDocument('company-1', 'designer-1', {
      title: '总装图',
      documentType: 'DRAWING',
      productId: 'product-1',
      orderId: 'order-1',
      fileRecordId: 'file-1',
    });

    expect(result).toMatchObject({
      documentNo: 'ED-P1001-000001',
      currentRevisionNo: 1,
    });
    const [createArgs] = tx.engineeringDocument.create.mock.calls[0] as [
      { data: { revisions: { create: Record<string, unknown> } } },
    ];
    expect(createArgs.data.revisions.create).toMatchObject({
      revisionNo: 1,
      status: 'DRAFT',
      fileRecordId: 'file-1',
      checksumSha256: 'a'.repeat(64),
      createdById: 'designer-1',
    });
  });

  it('rejects self review to enforce design and review separation', async () => {
    tx.engineeringDocumentRevision.findFirst.mockResolvedValue({
      id: 'revision-1',
      status: 'PENDING_REVIEW',
      createdById: 'designer-1',
      reviewedById: null,
      engineeringDocument: { companyId: 'company-1' },
    });

    await expect(
      service.reviewRevision('company-1', 'designer-1', 'revision-1', {
        decision: 'APPROVE',
        comment: 'ok',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('moves a reviewed revision to pending approval', async () => {
    tx.engineeringDocumentRevision.findFirst.mockResolvedValue({
      id: 'revision-1',
      status: 'PENDING_REVIEW',
      createdById: 'designer-1',
      reviewedById: null,
      engineeringDocument: { companyId: 'company-1' },
    });
    tx.engineeringDocumentRevision.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.reviewRevision(
      'company-1',
      'reviewer-1',
      'revision-1',
      { decision: 'APPROVE', comment: '尺寸符合要求' },
    );

    expect(result).toMatchObject({ status: 'PENDING_APPROVAL' });
    const [reviewUpdate] = tx.engineeringDocumentRevision.updateMany.mock
      .calls[0] as unknown as [
      {
        where: { id: string; status: string };
        data: { reviewedById: string };
      },
    ];
    expect(reviewUpdate.where).toEqual({
      id: 'revision-1',
      status: 'PENDING_REVIEW',
    });
    expect(reviewUpdate.data.reviewedById).toBe('reviewer-1');
  });

  it('rejects release by the designer or reviewer', async () => {
    tx.engineeringDocumentRevision.findFirst.mockResolvedValue({
      id: 'revision-1',
      status: 'PENDING_APPROVAL',
      createdById: 'designer-1',
      reviewedById: 'reviewer-1',
      engineeringDocument: { id: 'document-1', companyId: 'company-1' },
    });

    await expect(
      service.releaseRevision('company-1', 'reviewer-1', 'revision-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('releases one revision and obsoletes the previous released revision', async () => {
    tx.engineeringDocumentRevision.findFirst.mockResolvedValue({
      id: 'revision-2',
      revisionNo: 2,
      status: 'PENDING_APPROVAL',
      createdById: 'designer-1',
      reviewedById: 'reviewer-1',
      engineeringDocument: { id: 'document-1', companyId: 'company-1' },
    });
    tx.engineeringDocumentRevision.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    tx.engineeringDocument.update.mockResolvedValue({
      id: 'document-1',
      currentReleasedRevisionId: 'revision-2',
    });

    const result = await service.releaseRevision(
      'company-1',
      'approver-1',
      'revision-2',
    );

    expect(result).toMatchObject({ currentReleasedRevisionId: 'revision-2' });
    const [obsoleteUpdate] = tx.engineeringDocumentRevision.updateMany.mock
      .calls[1] as unknown as [
      {
        where: Record<string, unknown>;
        data: { status: string };
      },
    ];
    expect(obsoleteUpdate).toMatchObject({
      where: {
        engineeringDocumentId: 'document-1',
        status: 'RELEASED',
        id: { not: 'revision-2' },
      },
      data: { status: 'OBSOLETE' },
    });
  });

  it('rejects a concurrent state transition', async () => {
    tx.engineeringDocumentRevision.findFirst.mockResolvedValue({
      id: 'revision-1',
      status: 'PENDING_REVIEW',
      createdById: 'designer-1',
      reviewedById: null,
      engineeringDocument: { companyId: 'company-1' },
    });
    tx.engineeringDocumentRevision.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.reviewRevision('company-1', 'reviewer-1', 'revision-1', {
        decision: 'APPROVE',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
