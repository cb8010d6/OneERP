-- CreateTable
CREATE TABLE "SupplierPayment" (
    "id" TEXT NOT NULL,
    "paymentNo" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "method" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postingStatus" "EntryPostingStatus" NOT NULL DEFAULT 'DRAFT',
    "postedAt" TIMESTAMP(3),
    "note" TEXT,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierPaymentAllocation" (
    "id" TEXT NOT NULL,
    "supplierPaymentId" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_paymentNo_key" ON "SupplierPayment"("paymentNo");

-- CreateIndex
CREATE INDEX "SupplierPayment_companyId_paymentDate_idx" ON "SupplierPayment"("companyId", "paymentDate");

-- CreateIndex
CREATE INDEX "SupplierPayment_supplierId_paymentDate_idx" ON "SupplierPayment"("supplierId", "paymentDate");

-- CreateIndex
CREATE INDEX "SupplierPayment_postingStatus_idx" ON "SupplierPayment"("postingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPaymentAllocation_supplierPaymentId_purchaseInvoiceId_key" ON "SupplierPaymentAllocation"("supplierPaymentId", "purchaseInvoiceId");

-- CreateIndex
CREATE INDEX "SupplierPaymentAllocation_companyId_purchaseInvoiceId_idx" ON "SupplierPaymentAllocation"("companyId", "purchaseInvoiceId");

-- CreateIndex
CREATE INDEX "SupplierPaymentAllocation_purchaseInvoiceId_idx" ON "SupplierPaymentAllocation"("purchaseInvoiceId");

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_supplierPaymentId_fkey" FOREIGN KEY ("supplierPaymentId") REFERENCES "SupplierPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPaymentAllocation" ADD CONSTRAINT "SupplierPaymentAllocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
