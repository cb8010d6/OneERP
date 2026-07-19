import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PurchaseQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listSupplierCreditNotes(companyId: string) {
    return this.prisma.supplierCreditNote.findMany({
      where: { companyId },
      include: {
        purchaseInvoice: {
          select: {
            id: true,
            invoiceNo: true,
            purchaseOrder: { select: { purchaseNo: true } },
          },
        },
        supplier: { select: { id: true, name: true } },
        inventoryReturnDocument: {
          select: {
            id: true,
            returnNo: true,
            sourceDocumentNo: true,
          },
        },
      },
      orderBy: { creditDate: 'desc' },
      take: 100,
    });
  }

  async listSupplierPayments(companyId: string) {
    return this.prisma.supplierPayment.findMany({
      where: { companyId },
      include: {
        supplier: { select: { id: true, name: true } },
        allocations: {
          include: {
            purchaseInvoice: {
              select: {
                id: true,
                invoiceNo: true,
                purchaseOrder: { select: { purchaseNo: true } },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { paymentDate: 'desc' },
      take: 100,
    });
  }
}
