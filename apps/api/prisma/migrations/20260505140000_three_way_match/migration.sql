-- Three-Way Match: add financial fields to PurchaseOrder/PurchaseOrderLine, add matchStatus to PurchaseInvoice.

-- 1. ThreeWayMatchStatus enum
DO $$ BEGIN
  CREATE TYPE "ThreeWayMatchStatus" AS ENUM ('MATCHED', 'MISMATCH', 'PENDING_REVIEW', 'NOT_APPLICABLE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. PurchaseOrder: add financial summary columns
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "subTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "taxTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- 3. PurchaseOrderLine: add financial & detail columns
ALTER TABLE "PurchaseOrderLine" ADD COLUMN IF NOT EXISTS "lineNo" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PurchaseOrderLine" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "PurchaseOrderLine" ADD COLUMN IF NOT EXISTS "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrderLine" ADD COLUMN IF NOT EXISTS "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrderLine" ADD COLUMN IF NOT EXISTS "subTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrderLine" ADD COLUMN IF NOT EXISTS "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseOrderLine" ADD COLUMN IF NOT EXISTS "companyId" TEXT;

-- Make productId and materialId nullable (allow line with just one)
DO $$ BEGIN
  ALTER TABLE "PurchaseOrderLine" ALTER COLUMN "productId" DROP NOT NULL;
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PurchaseOrderLine" ALTER COLUMN "materialId" DROP NOT NULL;
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;

-- 4. PurchaseInvoice: add matchStatus column
ALTER TABLE "PurchaseInvoice" ADD COLUMN IF NOT EXISTS "matchStatus" "ThreeWayMatchStatus" NOT NULL DEFAULT 'NOT_APPLICABLE';

-- 5. Indexes for efficient match lookups
CREATE INDEX IF NOT EXISTS "PurchaseOrderLine_materialId_idx" ON "PurchaseOrderLine"("materialId");
CREATE INDEX IF NOT EXISTS "GoodsReceiptLine_materialId_idx" ON "GoodsReceiptLine"("materialId");
