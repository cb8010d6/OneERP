ALTER TABLE "Order"
ADD COLUMN "salesContractId" TEXT,
ADD COLUMN "contractVersionId" TEXT,
ADD COLUMN "sourceBatchKey" TEXT,
ADD COLUMN "sourceBatchHash" TEXT;

ALTER TABLE "OrderItem"
ADD COLUMN "sourceQuoteVersionItemId" TEXT;

CREATE UNIQUE INDEX "Order_companyId_sourceBatchKey_key" ON "Order"("companyId", "sourceBatchKey");
CREATE INDEX "Order_salesContractId_createdAt_idx" ON "Order"("salesContractId", "createdAt");
CREATE INDEX "OrderItem_sourceQuoteVersionItemId_idx" ON "OrderItem"("sourceQuoteVersionItemId");

ALTER TABLE "Order" ADD CONSTRAINT "Order_salesContractId_fkey" FOREIGN KEY ("salesContractId") REFERENCES "SalesContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_contractVersionId_fkey" FOREIGN KEY ("contractVersionId") REFERENCES "SalesContractVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_sourceQuoteVersionItemId_fkey" FOREIGN KEY ("sourceQuoteVersionItemId") REFERENCES "QuoteVersionItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
