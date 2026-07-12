ALTER TABLE "WorkReport"
ADD COLUMN "companyId" TEXT,
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "payloadHash" TEXT,
ADD COLUMN "inventoryTransactionIds" JSONB NOT NULL DEFAULT '[]';

UPDATE "WorkReport" report
SET
  "companyId" = work_order."companyId",
  "idempotencyKey" = 'legacy:' || report."id",
  "payloadHash" = md5(report."id")
FROM "WorkOrder" work_order
WHERE work_order."id" = report."workOrderId";

ALTER TABLE "WorkReport"
ALTER COLUMN "companyId" SET NOT NULL,
ALTER COLUMN "idempotencyKey" SET NOT NULL,
ALTER COLUMN "payloadHash" SET NOT NULL;

CREATE UNIQUE INDEX "WorkReport_companyId_idempotencyKey_key"
ON "WorkReport"("companyId", "idempotencyKey");
CREATE INDEX "WorkReport_companyId_reportDate_idx"
ON "WorkReport"("companyId", "reportDate");
CREATE INDEX "WorkReport_workOrderId_reportDate_idx"
ON "WorkReport"("workOrderId", "reportDate");

ALTER TABLE "WorkReport"
ADD CONSTRAINT "WorkReport_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
