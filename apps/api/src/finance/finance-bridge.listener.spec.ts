import { TestingModule, Test } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventDlq } from '@prisma/client';
import { EventQueueService } from '../core/events/event-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingService } from './accounting.service';
import { FinanceBridgeListener } from './finance-bridge.listener';
import { FinanceDlqService } from './finance-dlq.service';

describe.each([
  [
    'inventory.stock_depleted',
    'stock_depleted:move-1',
    'postStockDepletedEntry',
    {
      transactionId: 'move-1',
      materialId: 'm1',
      quantity: 2,
      referenceNo: 'SALE-SHIP-1',
    },
  ],
  [
    'purchase.supplier_payment.posted',
    'supplier_payment_posted:sp-1',
    'postSupplierPaymentEntry',
    { supplierPaymentId: 'sp-1' },
  ],
  [
    'purchase.supplier_credit_note.posted',
    'supplier_credit_note_posted:scn-1',
    'postSupplierCreditNotePostedEntry',
    { supplierCreditNoteId: 'scn-1' },
  ],
] as const)(
  'Finance queue/listener integration: %s',
  (eventName, idempotencyKey, accountingMethod, document) => {
    let module: TestingModule;
    let queue: EventQueueService;
    let event: EventDlq;
    const accounting = {
      postStockDepletedEntry: jest.fn(),
      postSupplierPaymentEntry: jest.fn(),
      postSupplierCreditNotePostedEntry: jest.fn(),
    };
    const financeDlq = { recordFailure: jest.fn() };
    const prisma = {
      supplierPayment: { findFirst: jest.fn() },
      supplierCreditNote: { findFirst: jest.fn() },
      journalEntry: { findFirst: jest.fn() },
      eventDlq: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
    };

    beforeEach(async () => {
      jest.resetAllMocks();
      event = {
        id: 'event-1',
        companyId: 'c1',
        eventName,
        idempotencyKey,
        payload: { companyId: 'c1', idempotencyKey, ...document },
        status: 'PENDING',
        error: '',
        attempts: 0,
        maxAttempts: 5,
        nextRetryAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prisma.supplierPayment.findFirst.mockResolvedValue({ id: 'sp-1' });
      prisma.supplierCreditNote.findFirst.mockResolvedValue({
        creditNo: 'SCN-001',
      });
      prisma.journalEntry.findFirst.mockResolvedValue(null);
      prisma.eventDlq.findFirst.mockResolvedValue(null);
      prisma.eventDlq.findUnique.mockImplementation(() =>
        Promise.resolve({ ...event }),
      );
      prisma.eventDlq.updateMany.mockImplementation(
        (args: { where: { status: { in: string[] } } }) => {
          if (!args.where.status.in.includes(event.status))
            return Promise.resolve({ count: 0 });
          event = {
            ...event,
            status: 'RETRYING',
            attempts: event.attempts + 1,
          };
          return Promise.resolve({ count: 1 });
        },
      );
      prisma.eventDlq.update.mockImplementation(
        (args: { data: Partial<EventDlq> }) => {
          event = { ...event, ...args.data };
          return Promise.resolve({ ...event });
        },
      );
      module = await Test.createTestingModule({
        imports: [EventEmitterModule.forRoot()],
        providers: [
          FinanceBridgeListener,
          EventQueueService,
          { provide: AccountingService, useValue: accounting },
          { provide: FinanceDlqService, useValue: financeDlq },
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      await module.init();
      queue = module.get(EventQueueService);
    });

    afterEach(async () => {
      await module.close();
    });

    it('retains the original durable event on listener failure and resolves it on retry', async () => {
      accounting[accountingMethod]
        .mockRejectedValueOnce(new Error('accounting unavailable'))
        .mockResolvedValueOnce({ id: 'journal-1' });
      const failed = await queue.dispatchById(event.id);
      expect(failed).toEqual({
        id: 'event-1',
        status: 'PENDING',
        error: 'accounting unavailable',
      });
      expect(event.status).toBe('PENDING');
      expect(event.attempts).toBe(1);
      expect(event.nextRetryAt).toBeInstanceOf(Date);
      expect(financeDlq.recordFailure).not.toHaveBeenCalled();
      expect(prisma.eventDlq.create).not.toHaveBeenCalled();

      const retried = await queue.dispatchById(event.id);
      expect(retried).toEqual({ id: 'event-1', status: 'RESOLVED' });
      expect(event.status).toBe('RESOLVED');
      expect(event.attempts).toBe(2);
      expect(accounting[accountingMethod]).toHaveBeenCalledTimes(2);
      expect(accounting[accountingMethod]).toHaveBeenLastCalledWith(
        event.payload,
      );
    });

    it('resolves a retry whose journal already exists without creating it again', async () => {
      prisma.journalEntry.findFirst.mockResolvedValue({
        id: 'existing-journal',
      });
      await expect(queue.dispatchById(event.id)).resolves.toEqual({
        id: 'event-1',
        status: 'RESOLVED',
      });
      if (eventName === 'inventory.stock_depleted') {
        // A shared reference is not a stock-movement receipt. The accounting
        // transaction, not this listener, must deduplicate movement delivery.
        expect(accounting[accountingMethod]).toHaveBeenCalledWith(
          event.payload,
        );
        expect(prisma.journalEntry.findFirst).not.toHaveBeenCalled();
        return;
      }
      expect(accounting[accountingMethod]).not.toHaveBeenCalled();
      expect(financeDlq.recordFailure).not.toHaveBeenCalled();
      expect(prisma.journalEntry.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: 'c1' }) as unknown,
        }),
      );
    });
  },
);
