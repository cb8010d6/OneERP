-- AlterTable
ALTER TABLE "CreditNote" ADD COLUMN "inventoryReturnDocumentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_inventoryReturnDocumentId_key" ON "CreditNote"("inventoryReturnDocumentId");

-- CreateIndex
CREATE INDEX "CreditNote_inventoryReturnDocumentId_idx" ON "CreditNote"("inventoryReturnDocumentId");

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_inventoryReturnDocumentId_fkey" FOREIGN KEY ("inventoryReturnDocumentId") REFERENCES "InventoryReturnDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
