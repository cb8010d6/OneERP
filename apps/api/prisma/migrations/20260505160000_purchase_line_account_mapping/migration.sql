-- AlterTable: Add accountId to PurchaseInvoiceLine for expense/inventory account mapping
ALTER TABLE "PurchaseInvoiceLine" ADD COLUMN "accountId" TEXT;

-- AddForeignKey
ALTER TABLE "PurchaseInvoiceLine" ADD CONSTRAINT "PurchaseInvoiceLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
