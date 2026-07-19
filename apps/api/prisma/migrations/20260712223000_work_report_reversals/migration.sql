CREATE TABLE "WorkReportReversal" (
  "id" TEXT NOT NULL,
  "workReportId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "reversedById" TEXT NOT NULL,
  "inventoryTransactionIds" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkReportReversal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkReportReversal_workReportId_key"
ON "WorkReportReversal"("workReportId");
CREATE UNIQUE INDEX "WorkReportReversal_companyId_idempotencyKey_key"
ON "WorkReportReversal"("companyId", "idempotencyKey");
CREATE INDEX "WorkReportReversal_companyId_createdAt_idx"
ON "WorkReportReversal"("companyId", "createdAt");

ALTER TABLE "WorkReportReversal"
ADD CONSTRAINT "WorkReportReversal_workReportId_fkey" FOREIGN KEY ("workReportId") REFERENCES "WorkReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "WorkReportReversal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "WorkReportReversal_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
