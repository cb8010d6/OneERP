-- TaxService refactor: TaxNature enum, split tax accounts, tax snapshots, PurchaseInvoice.
-- This migration is additive and backward-compatible.

-- 1. TaxNature enum
DO $$ BEGIN
  CREATE TYPE "TaxNature" AS ENUM ('OUTPUT', 'INPUT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. TaxCode: add taxNature, outputAccountId, inputAccountId
ALTER TABLE "TaxCode" ADD COLUMN IF NOT EXISTS "taxNature" "TaxNature" NOT NULL DEFAULT 'OUTPUT';
ALTER TABLE "TaxCode" ADD COLUMN IF NOT EXISTS "outputAccountId" TEXT;
ALTER TABLE "TaxCode" ADD COLUMN IF NOT EXISTS "inputAccountId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaxCode_outputAccountId_fkey') THEN
    ALTER TABLE "TaxCode" ADD CONSTRAINT "TaxCode_outputAccountId_fkey"
      FOREIGN KEY ("outputAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaxCode_inputAccountId_fkey') THEN
    ALTER TABLE "TaxCode" ADD CONSTRAINT "TaxCode_inputAccountId_fkey"
      FOREIGN KEY ("inputAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "TaxCode_outputAccountId_idx" ON "TaxCode"("outputAccountId");
CREATE INDEX IF NOT EXISTS "TaxCode_inputAccountId_idx" ON "TaxCode"("inputAccountId");

-- Backfill: copy existing accountId to outputAccountId for OUTPUT tax codes, inputAccountId for INPUT
UPDATE "TaxCode" SET "outputAccountId" = "accountId" WHERE "accountId" IS NOT NULL AND "taxNature" = 'OUTPUT';
UPDATE "TaxCode" SET "inputAccountId" = "accountId" WHERE "accountId" IS NOT NULL AND "taxNature" = 'INPUT';

-- 3. Invoice: add taxRate, taxNature snapshot columns
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "taxNature" "TaxNature" NOT NULL DEFAULT 'OUTPUT';

-- 4. PurchaseInvoice table
CREATE TABLE IF NOT EXISTS "PurchaseInvoice" (
    "id" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "subTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxCodeId" TEXT,
    "taxNature" "TaxNature" NOT NULL DEFAULT 'INPUT',
    "status" TEXT NOT NULL,
    "postingStatus" "EntryPostingStatus" NOT NULL DEFAULT 'DRAFT',
    "companyId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "issuedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseInvoice_invoiceNo_key" ON "PurchaseInvoice"("invoiceNo");
CREATE INDEX IF NOT EXISTS "PurchaseInvoice_companyId_status_idx" ON "PurchaseInvoice"("companyId", "status");
CREATE INDEX IF NOT EXISTS "PurchaseInvoice_partnerId_idx" ON "PurchaseInvoice"("partnerId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseInvoice_partnerId_fkey') THEN
    ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_partnerId_fkey"
      FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseInvoice_companyId_fkey') THEN
    ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseInvoice_taxCodeId_fkey') THEN
    ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_taxCodeId_fkey"
      FOREIGN KEY ("taxCodeId") REFERENCES "TaxCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
