-- TaxCode engine: master data and tax snapshot fields.
-- Historical rows keep zero snapshots; application fallback recalculates on posting.

CREATE TABLE IF NOT EXISTS "TaxCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isTaxInclusive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "accountId" TEXT,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxCode_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "subTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "taxTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;

ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "subTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;

ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "subTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "taxCodeId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "TaxCode_companyId_code_key" ON "TaxCode"("companyId", "code");
CREATE INDEX IF NOT EXISTS "TaxCode_companyId_active_idx" ON "TaxCode"("companyId", "active");
CREATE INDEX IF NOT EXISTS "TaxCode_accountId_idx" ON "TaxCode"("accountId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaxCode_companyId_fkey') THEN
    ALTER TABLE "TaxCode" ADD CONSTRAINT "TaxCode_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF to_regclass('"Account"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaxCode_accountId_fkey') THEN
    ALTER TABLE "TaxCode" ADD CONSTRAINT "TaxCode_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Order_taxCodeId_fkey') THEN
    ALTER TABLE "Order" ADD CONSTRAINT "Order_taxCodeId_fkey"
      FOREIGN KEY ("taxCodeId") REFERENCES "TaxCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrderItem_taxCodeId_fkey') THEN
    ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_taxCodeId_fkey"
      FOREIGN KEY ("taxCodeId") REFERENCES "TaxCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Invoice_taxCodeId_fkey') THEN
    ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_taxCodeId_fkey"
      FOREIGN KEY ("taxCodeId") REFERENCES "TaxCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
