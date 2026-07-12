CREATE TABLE "EngineeringChangeOrder" (
  "id" TEXT NOT NULL,
  "ecoNo" TEXT NOT NULL,
  "engineeringDocumentId" TEXT NOT NULL,
  "sourceRevisionId" TEXT NOT NULL,
  "targetRevisionId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "reason" TEXT NOT NULL,
  "impactAssessment" TEXT NOT NULL,
  "materialDisposition" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "approvalComment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EngineeringChangeOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EngineeringChangeImpact" (
  "id" TEXT NOT NULL,
  "engineeringChangeOrderId" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "note" TEXT,
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EngineeringChangeImpact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EngineeringChangeOrder_targetRevisionId_key" ON "EngineeringChangeOrder"("targetRevisionId");
CREATE UNIQUE INDEX "EngineeringChangeOrder_companyId_ecoNo_key" ON "EngineeringChangeOrder"("companyId", "ecoNo");
CREATE INDEX "EngineeringChangeOrder_companyId_status_createdAt_idx" ON "EngineeringChangeOrder"("companyId", "status", "createdAt");
CREATE INDEX "EngineeringChangeOrder_engineeringDocumentId_createdAt_idx" ON "EngineeringChangeOrder"("engineeringDocumentId", "createdAt");
CREATE INDEX "EngineeringChangeOrder_sourceRevisionId_idx" ON "EngineeringChangeOrder"("sourceRevisionId");
CREATE UNIQUE INDEX "EngineeringChangeImpact_engineeringChangeOrderId_workOrderId_key" ON "EngineeringChangeImpact"("engineeringChangeOrderId", "workOrderId");
CREATE INDEX "EngineeringChangeImpact_companyId_createdAt_idx" ON "EngineeringChangeImpact"("companyId", "createdAt");
CREATE INDEX "EngineeringChangeImpact_workOrderId_idx" ON "EngineeringChangeImpact"("workOrderId");

ALTER TABLE "EngineeringChangeOrder"
ADD CONSTRAINT "EngineeringChangeOrder_engineeringDocumentId_fkey" FOREIGN KEY ("engineeringDocumentId") REFERENCES "EngineeringDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "EngineeringChangeOrder_sourceRevisionId_fkey" FOREIGN KEY ("sourceRevisionId") REFERENCES "EngineeringDocumentRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "EngineeringChangeOrder_targetRevisionId_fkey" FOREIGN KEY ("targetRevisionId") REFERENCES "EngineeringDocumentRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "EngineeringChangeOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "EngineeringChangeOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "EngineeringChangeOrder_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EngineeringChangeImpact"
ADD CONSTRAINT "EngineeringChangeImpact_engineeringChangeOrderId_fkey" FOREIGN KEY ("engineeringChangeOrderId") REFERENCES "EngineeringChangeOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "EngineeringChangeImpact_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "EngineeringChangeImpact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
