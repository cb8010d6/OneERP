CREATE TABLE "WorkOrderEngineeringRevision" (
  "id" TEXT NOT NULL,
  "workOrderId" TEXT NOT NULL,
  "engineeringRevisionId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "pinnedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkOrderEngineeringRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkOrderEngineeringRevision_workOrderId_engineeringRevisionId_key"
ON "WorkOrderEngineeringRevision"("workOrderId", "engineeringRevisionId");
CREATE INDEX "WorkOrderEngineeringRevision_companyId_createdAt_idx"
ON "WorkOrderEngineeringRevision"("companyId", "createdAt");
CREATE INDEX "WorkOrderEngineeringRevision_engineeringRevisionId_idx"
ON "WorkOrderEngineeringRevision"("engineeringRevisionId");

ALTER TABLE "WorkOrderEngineeringRevision"
ADD CONSTRAINT "WorkOrderEngineeringRevision_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "WorkOrderEngineeringRevision_engineeringRevisionId_fkey" FOREIGN KEY ("engineeringRevisionId") REFERENCES "EngineeringDocumentRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "WorkOrderEngineeringRevision_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "WorkOrderEngineeringRevision_pinnedById_fkey" FOREIGN KEY ("pinnedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
