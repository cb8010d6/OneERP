-- Extend purchase order status workflow for submit/approval stages.
ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'APPROVED';

-- Link stock pickings to source business documents.
ALTER TABLE "StockPicking" ADD COLUMN IF NOT EXISTS "referenceType" TEXT;
ALTER TABLE "StockPicking" ADD COLUMN IF NOT EXISTS "referenceId" TEXT;

-- Support material-only stock moves and execution tracking.
ALTER TABLE "StockMove" ADD COLUMN IF NOT EXISTS "lineNo" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "StockMove" ADD COLUMN IF NOT EXISTS "quantityDone" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "StockMove" ALTER COLUMN "productId" DROP NOT NULL;

-- Relation and lookup indexes used by picking and inventory flows.
CREATE INDEX IF NOT EXISTS "StockPicking_companyId_referenceType_referenceId_idx" ON "StockPicking"("companyId", "referenceType", "referenceId");
