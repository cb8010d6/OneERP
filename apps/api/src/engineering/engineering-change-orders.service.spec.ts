/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { EngineeringChangeOrdersService } from './engineering-change-orders.service';

describe('EngineeringChangeOrdersService', () => {
  const tx = {
    engineeringDocument: { findFirst: jest.fn(), update: jest.fn() },
    workOrder: { findMany: jest.fn() },
    documentSequence: { upsert: jest.fn() },
    engineeringChangeOrder: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    engineeringDocumentRevision: { update: jest.fn() },
    workOrderEngineeringRevision: { updateMany: jest.fn() },
    engineeringChangeImpact: { updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const prisma = {
    ...tx,
    engineeringChangeOrder: {
      ...tx.engineeringChangeOrder,
      findMany: jest.fn(),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  let service: EngineeringChangeOrdersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EngineeringChangeOrdersService(prisma as never);
    tx.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  });

  function mockContext() {
    tx.engineeringDocument.findFirst.mockResolvedValue({
      id: 'document-1',
      documentNo: 'ED-001',
      title: '主图',
      currentReleasedRevisionId: 'revision-old',
      currentReleasedRevision: {
        id: 'revision-old',
        status: 'RELEASED',
        revisionNo: 1,
      },
      revisions: [
        { id: 'revision-new', status: 'PENDING_APPROVAL', revisionNo: 2 },
      ],
    });
  }

  it('creates an ECO only when every affected work order has a disposition', async () => {
    mockContext();
    tx.workOrder.findMany.mockResolvedValue([
      { id: 'wo-1', workOrderNo: 'WO-001' },
      { id: 'wo-2', workOrderNo: 'WO-002' },
    ]);
    tx.documentSequence.upsert.mockResolvedValue({ lastValue: 3 });
    tx.engineeringChangeOrder.create.mockResolvedValue({
      id: 'eco-1',
      ecoNo: 'ECO-2026-000003',
    });

    const result = await service.create(
      'company-1',
      'creator-1',
      'document-1',
      {
        targetRevisionId: 'revision-new',
        reason: '客户变更',
        impactAssessment: '影响两张工单',
        materialDisposition: '隔离旧料',
        impacts: [
          { workOrderId: 'wo-1', decision: 'SWITCH_NEW' },
          {
            workOrderId: 'wo-2',
            decision: 'CONTINUE_OLD',
            note: '偏差批准 DA-01',
          },
        ],
      },
    );

    expect(result).toEqual({ id: 'eco-1', ecoNo: 'ECO-2026-000003' });
    expect(tx.engineeringChangeOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceRevisionId: 'revision-old',
          targetRevisionId: 'revision-new',
          impacts: {
            create: [
              expect.objectContaining({
                workOrderId: 'wo-1',
                decision: 'SWITCH_NEW',
              }),
              expect.objectContaining({
                workOrderId: 'wo-2',
                decision: 'CONTINUE_OLD',
              }),
            ],
          },
        }),
      }),
    );
  });

  it('rejects incomplete impact coverage', async () => {
    mockContext();
    tx.workOrder.findMany.mockResolvedValue([
      { id: 'wo-1', workOrderNo: 'WO-001' },
      { id: 'wo-2', workOrderNo: 'WO-002' },
    ]);

    await expect(
      service.create('company-1', 'creator-1', 'document-1', {
        targetRevisionId: 'revision-new',
        reason: '变更',
        impactAssessment: '影响',
        materialDisposition: '隔离',
        impacts: [{ workOrderId: 'wo-1', decision: 'SWITCH_NEW' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a disposition note when continuing the old revision', async () => {
    mockContext();
    tx.workOrder.findMany.mockResolvedValue([
      { id: 'wo-1', workOrderNo: 'WO-001' },
    ]);

    await expect(
      service.create('company-1', 'creator-1', 'document-1', {
        targetRevisionId: 'revision-new',
        reason: '变更',
        impactAssessment: '影响',
        materialDisposition: '隔离',
        impacts: [{ workOrderId: 'wo-1', decision: 'CONTINUE_OLD' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('approves atomically and switches only selected work orders', async () => {
    tx.engineeringChangeOrder.findFirst.mockResolvedValue({
      id: 'eco-1',
      status: 'PENDING_APPROVAL',
      createdById: 'creator-1',
      engineeringDocumentId: 'document-1',
      sourceRevisionId: 'revision-old',
      targetRevisionId: 'revision-new',
      engineeringDocument: { currentReleasedRevisionId: 'revision-old' },
      sourceRevision: { id: 'revision-old', status: 'RELEASED' },
      targetRevision: { id: 'revision-new', status: 'PENDING_APPROVAL' },
      impacts: [
        { workOrderId: 'wo-1', decision: 'SWITCH_NEW', note: null },
        {
          workOrderId: 'wo-2',
          decision: 'CONTINUE_OLD',
          note: '偏差批准 DA-01',
        },
      ],
    });
    tx.workOrder.findMany.mockResolvedValue([{ id: 'wo-1' }, { id: 'wo-2' }]);
    tx.workOrderEngineeringRevision.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.decide('company-1', 'approver-1', 'eco-1', {
        decision: 'APPROVE',
        comment: '批准',
      }),
    ).resolves.toEqual({ id: 'eco-1', status: 'APPROVED' });

    expect(tx.engineeringDocumentRevision.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'revision-new' },
        data: expect.objectContaining({ status: 'RELEASED' }),
      }),
    );
    expect(tx.workOrderEngineeringRevision.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.workOrderEngineeringRevision.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workOrderId: 'wo-1',
          engineeringRevisionId: 'revision-old',
        }),
        data: expect.objectContaining({
          engineeringRevisionId: 'revision-new',
        }),
      }),
    );
  });

  it('rejects approval when a new affected work order appears after submission', async () => {
    tx.engineeringChangeOrder.findFirst.mockResolvedValue({
      id: 'eco-1',
      status: 'PENDING_APPROVAL',
      createdById: 'creator-1',
      engineeringDocumentId: 'document-1',
      sourceRevisionId: 'revision-old',
      targetRevisionId: 'revision-new',
      engineeringDocument: { currentReleasedRevisionId: 'revision-old' },
      sourceRevision: { status: 'RELEASED' },
      targetRevision: { status: 'PENDING_APPROVAL' },
      impacts: [{ workOrderId: 'wo-1', decision: 'SWITCH_NEW', note: null }],
    });
    tx.workOrder.findMany.mockResolvedValue([
      { id: 'wo-1' },
      { id: 'wo-late' },
    ]);

    await expect(
      service.decide('company-1', 'approver-1', 'eco-1', {
        decision: 'APPROVE',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.engineeringDocumentRevision.update).not.toHaveBeenCalled();
  });

  it('prevents the ECO creator from approving their own change', async () => {
    tx.engineeringChangeOrder.findFirst.mockResolvedValue({
      id: 'eco-1',
      status: 'PENDING_APPROVAL',
      createdById: 'creator-1',
    });

    await expect(
      service.decide('company-1', 'creator-1', 'eco-1', {
        decision: 'APPROVE',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns the target revision for changes when the ECO is rejected', async () => {
    tx.engineeringChangeOrder.findFirst.mockResolvedValue({
      id: 'eco-1',
      status: 'PENDING_APPROVAL',
      createdById: 'creator-1',
      targetRevisionId: 'revision-new',
    });

    await expect(
      service.decide('company-1', 'approver-1', 'eco-1', {
        decision: 'REJECT',
        comment: '影响评估不完整',
      }),
    ).resolves.toEqual({ id: 'eco-1', status: 'REJECTED' });
    expect(tx.engineeringDocumentRevision.update).toHaveBeenCalledWith({
      where: { id: 'revision-new' },
      data: {
        status: 'CHANGES_REQUESTED',
        reviewComment: '影响评估不完整',
      },
    });
  });

  it('rejects stale version state during approval', async () => {
    tx.engineeringChangeOrder.findFirst.mockResolvedValue({
      id: 'eco-1',
      status: 'PENDING_APPROVAL',
      createdById: 'creator-1',
      sourceRevisionId: 'revision-old',
      targetRevisionId: 'revision-new',
      engineeringDocument: { currentReleasedRevisionId: 'another-revision' },
      sourceRevision: { status: 'OBSOLETE' },
      targetRevision: { status: 'PENDING_APPROVAL' },
      impacts: [],
    });

    await expect(
      service.decide('company-1', 'approver-1', 'eco-1', {
        decision: 'APPROVE',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
