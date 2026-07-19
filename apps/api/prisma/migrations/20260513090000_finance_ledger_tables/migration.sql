-- Finance ledger and DLQ tables required by production initialization.
-- Kept idempotent so existing pilot databases can apply it safely.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'JournalType') THEN
    CREATE TYPE "JournalType" AS ENUM ('GENERAL', 'CASH', 'BANK', 'SALES', 'PURCHASE', 'INVENTORY');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EntryPostingStatus') THEN
    CREATE TYPE "EntryPostingStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CustomFieldType') THEN
    CREATE TYPE "CustomFieldType" AS ENUM ('STRING', 'NUMBER', 'REF');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Account" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "parentId" TEXT,
    "companyId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Journal" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "JournalType" NOT NULL DEFAULT 'GENERAL',
    "companyId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Journal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JournalEntry" (
    "id" TEXT NOT NULL,
    "entryNo" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "ref" TEXT,
    "description" TEXT,
    "journalId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "postingStatus" "EntryPostingStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "JournalEntryLine" (
    "id" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "partnerId" TEXT,
    "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntryLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EventDlq" (
    "id" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRetryAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventDlq_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StockQuant" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockQuant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CustomFieldDefinition" (
    "id" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "referenceModel" TEXT,
    "referenceLabelField" TEXT,
    "referenceValueField" TEXT,
    "referenceRelationField" TEXT,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Workflow" (
    "id" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "statusField" TEXT NOT NULL DEFAULT 'status',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WorkflowState" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isInitial" BOOLEAN NOT NULL DEFAULT false,
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WorkflowTransition" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "fromStateId" TEXT NOT NULL,
    "toStateId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowTransition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Account_companyId_code_key" ON "Account"("companyId", "code");
CREATE INDEX IF NOT EXISTS "Account_companyId_parentId_idx" ON "Account"("companyId", "parentId");

CREATE UNIQUE INDEX IF NOT EXISTS "Journal_companyId_code_key" ON "Journal"("companyId", "code");
CREATE INDEX IF NOT EXISTS "Journal_companyId_type_idx" ON "Journal"("companyId", "type");

CREATE UNIQUE INDEX IF NOT EXISTS "JournalEntry_companyId_entryNo_key" ON "JournalEntry"("companyId", "entryNo");
CREATE INDEX IF NOT EXISTS "JournalEntry_companyId_journalId_date_idx" ON "JournalEntry"("companyId", "journalId", "date");

CREATE UNIQUE INDEX IF NOT EXISTS "JournalEntryLine_journalEntryId_lineNo_key" ON "JournalEntryLine"("journalEntryId", "lineNo");
CREATE INDEX IF NOT EXISTS "JournalEntryLine_accountId_idx" ON "JournalEntryLine"("accountId");
CREATE INDEX IF NOT EXISTS "JournalEntryLine_partnerId_idx" ON "JournalEntryLine"("partnerId");

CREATE INDEX IF NOT EXISTS "EventDlq_status_nextRetryAt_idx" ON "EventDlq"("status", "nextRetryAt");
CREATE INDEX IF NOT EXISTS "EventDlq_eventName_idx" ON "EventDlq"("eventName");
CREATE INDEX IF NOT EXISTS "EventDlq_eventName_idempotencyKey_idx" ON "EventDlq"("eventName", "idempotencyKey");

ALTER TABLE "Partner" ADD COLUMN IF NOT EXISTS "customAttributes" JSONB;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "partnerId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "customAttributes" JSONB;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "customAttributes" JSONB;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "customAttributes" JSONB;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "postingStatus" "EntryPostingStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS "StockQuant_locationId_materialId_batchNo_key" ON "StockQuant"("locationId", "materialId", "batchNo");
CREATE INDEX IF NOT EXISTS "StockQuant_materialId_idx" ON "StockQuant"("materialId");
CREATE UNIQUE INDEX IF NOT EXISTS "CustomFieldDefinition_companyId_modelName_fieldName_key" ON "CustomFieldDefinition"("companyId", "modelName", "fieldName");
CREATE INDEX IF NOT EXISTS "CustomFieldDefinition_companyId_modelName_idx" ON "CustomFieldDefinition"("companyId", "modelName");
CREATE UNIQUE INDEX IF NOT EXISTS "Workflow_companyId_modelName_key" ON "Workflow"("companyId", "modelName");
CREATE INDEX IF NOT EXISTS "Workflow_modelName_idx" ON "Workflow"("modelName");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowState_workflowId_value_key" ON "WorkflowState"("workflowId", "value");
CREATE INDEX IF NOT EXISTS "WorkflowState_workflowId_sort_idx" ON "WorkflowState"("workflowId", "sort");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowTransition_workflowId_fromStateId_action_key" ON "WorkflowTransition"("workflowId", "fromStateId", "action");
CREATE INDEX IF NOT EXISTS "WorkflowTransition_workflowId_action_idx" ON "WorkflowTransition"("workflowId", "action");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Customer') THEN
    INSERT INTO "Partner" (
      "id",
      "name",
      "type",
      "contact",
      "phone",
      "email",
      "address",
      "companyId",
      "createdAt",
      "updatedAt"
    )
    SELECT
      c."id",
      c."name",
      'CUSTOMER'::"PartnerType",
      c."contact",
      c."phone",
      c."email",
      c."address",
      c."companyId",
      COALESCE(c."createdAt", CURRENT_TIMESTAMP),
      CURRENT_TIMESTAMP
    FROM "Customer" c
    WHERE NOT EXISTS (SELECT 1 FROM "Partner" p WHERE p."id" = c."id");

    UPDATE "Order" o
    SET "partnerId" = o."customerId"
    WHERE o."partnerId" IS NULL
      AND o."customerId" IS NOT NULL
      AND EXISTS (SELECT 1 FROM "Partner" p WHERE p."id" = o."customerId");
  END IF;

  IF EXISTS (SELECT 1 FROM "Order" WHERE "partnerId" IS NULL) THEN
    RAISE EXCEPTION 'Order.partnerId migration failed: some existing orders cannot be mapped from Customer to Partner.';
  END IF;
END $$;

ALTER TABLE "Order" ALTER COLUMN "partnerId" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "Order_partnerId_idx" ON "Order"("partnerId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Account_companyId_fkey') THEN
    ALTER TABLE "Account" ADD CONSTRAINT "Account_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Account_parentId_fkey') THEN
    ALTER TABLE "Account" ADD CONSTRAINT "Account_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Journal_companyId_fkey') THEN
    ALTER TABLE "Journal" ADD CONSTRAINT "Journal_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JournalEntry_journalId_fkey') THEN
    ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_journalId_fkey"
      FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JournalEntry_companyId_fkey') THEN
    ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JournalEntryLine_journalEntryId_fkey') THEN
    ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_journalEntryId_fkey"
      FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JournalEntryLine_accountId_fkey') THEN
    ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'JournalEntryLine_partnerId_fkey') THEN
    ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_partnerId_fkey"
      FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EventDlq_companyId_fkey') THEN
    ALTER TABLE "EventDlq" ADD CONSTRAINT "EventDlq_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockQuant_locationId_fkey') THEN
    ALTER TABLE "StockQuant" ADD CONSTRAINT "StockQuant_locationId_fkey"
      FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockQuant_materialId_fkey') THEN
    ALTER TABLE "StockQuant" ADD CONSTRAINT "StockQuant_materialId_fkey"
      FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CustomFieldDefinition_companyId_fkey') THEN
    ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Workflow_companyId_fkey') THEN
    ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkflowState_workflowId_fkey') THEN
    ALTER TABLE "WorkflowState" ADD CONSTRAINT "WorkflowState_workflowId_fkey"
      FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkflowTransition_workflowId_fkey') THEN
    ALTER TABLE "WorkflowTransition" ADD CONSTRAINT "WorkflowTransition_workflowId_fkey"
      FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkflowTransition_fromStateId_fkey') THEN
    ALTER TABLE "WorkflowTransition" ADD CONSTRAINT "WorkflowTransition_fromStateId_fkey"
      FOREIGN KEY ("fromStateId") REFERENCES "WorkflowState"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkflowTransition_toStateId_fkey') THEN
    ALTER TABLE "WorkflowTransition" ADD CONSTRAINT "WorkflowTransition_toStateId_fkey"
      FOREIGN KEY ("toStateId") REFERENCES "WorkflowState"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'TaxCode')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TaxCode_accountId_fkey') THEN
    ALTER TABLE "TaxCode" ADD CONSTRAINT "TaxCode_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Order_partnerId_fkey') THEN
    ALTER TABLE "Order" ADD CONSTRAINT "Order_partnerId_fkey"
      FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
