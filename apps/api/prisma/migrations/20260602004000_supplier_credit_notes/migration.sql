-- CreateTable
CREATE TABLE "SupplierCreditNote" (
    "id" TEXT NOT NULL,
    "creditNo" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "inventoryReturnDocumentId" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "postingStatus" "EntryPostingStatus" NOT NULL DEFAULT 'DRAFT',
    "postedAt" TIMESTAMP(3),
    "creditDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierCreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCreditNote_creditNo_key" ON "SupplierCreditNote"("creditNo");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCreditNote_inventoryReturnDocumentId_key" ON "SupplierCreditNote"("inventoryReturnDocumentId");

-- CreateIndex
CREATE INDEX "SupplierCreditNote_companyId_creditDate_idx" ON "SupplierCreditNote"("companyId", "creditDate");

-- CreateIndex
CREATE INDEX "SupplierCreditNote_purchaseInvoiceId_idx" ON "SupplierCreditNote"("purchaseInvoiceId");

-- CreateIndex
CREATE INDEX "SupplierCreditNote_supplierId_creditDate_idx" ON "SupplierCreditNote"("supplierId", "creditDate");

-- CreateIndex
CREATE INDEX "SupplierCreditNote_postingStatus_idx" ON "SupplierCreditNote"("postingStatus");

-- CreateIndex
CREATE INDEX "SupplierCreditNote_inventoryReturnDocumentId_idx" ON "SupplierCreditNote"("inventoryReturnDocumentId");

-- AddForeignKey
ALTER TABLE "SupplierCreditNote" ADD CONSTRAINT "SupplierCreditNote_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCreditNote" ADD CONSTRAINT "SupplierCreditNote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCreditNote" ADD CONSTRAINT "SupplierCreditNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCreditNote" ADD CONSTRAINT "SupplierCreditNote_inventoryReturnDocumentId_fkey" FOREIGN KEY ("inventoryReturnDocumentId") REFERENCES "InventoryReturnDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
