ALTER TABLE "FileRecord"
ADD COLUMN "checksumSha256" TEXT;

CREATE TABLE "EngineeringDocument" (
  "id" TEXT NOT NULL,
  "documentNo" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "externalNo" TEXT,
  "productId" TEXT,
  "orderId" TEXT,
  "currentRevisionNo" INTEGER NOT NULL DEFAULT 1,
  "currentReleasedRevisionId" TEXT,
  "companyId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EngineeringDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EngineeringDocumentRevision" (
  "id" TEXT NOT NULL,
  "engineeringDocumentId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "revisionNo" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "fileRecordId" TEXT NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewComment" TEXT,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "obsoleteAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EngineeringDocumentRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EngineeringDocument_companyId_documentNo_key" ON "EngineeringDocument"("companyId", "documentNo");
CREATE UNIQUE INDEX "EngineeringDocument_currentReleasedRevisionId_key" ON "EngineeringDocument"("currentReleasedRevisionId");
CREATE INDEX "EngineeringDocument_companyId_updatedAt_idx" ON "EngineeringDocument"("companyId", "updatedAt");
CREATE INDEX "EngineeringDocument_companyId_productId_idx" ON "EngineeringDocument"("companyId", "productId");
CREATE INDEX "EngineeringDocument_companyId_orderId_idx" ON "EngineeringDocument"("companyId", "orderId");
CREATE UNIQUE INDEX "EngineeringDocumentRevision_fileRecordId_key" ON "EngineeringDocumentRevision"("fileRecordId");
CREATE UNIQUE INDEX "EngineeringDocumentRevision_engineeringDocumentId_revisionNo_key" ON "EngineeringDocumentRevision"("engineeringDocumentId", "revisionNo");
CREATE INDEX "EngineeringDocumentRevision_companyId_createdAt_idx" ON "EngineeringDocumentRevision"("companyId", "createdAt");
CREATE INDEX "EngineeringDocumentRevision_engineeringDocumentId_status_idx" ON "EngineeringDocumentRevision"("engineeringDocumentId", "status");

ALTER TABLE "EngineeringDocument"
ADD CONSTRAINT "EngineeringDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "EngineeringDocument_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "EngineeringDocument_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "EngineeringDocument_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EngineeringDocumentRevision"
ADD CONSTRAINT "EngineeringDocumentRevision_engineeringDocumentId_fkey" FOREIGN KEY ("engineeringDocumentId") REFERENCES "EngineeringDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "EngineeringDocumentRevision_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "EngineeringDocumentRevision_fileRecordId_fkey" FOREIGN KEY ("fileRecordId") REFERENCES "FileRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "EngineeringDocumentRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "EngineeringDocumentRevision_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "EngineeringDocumentRevision_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EngineeringDocument"
ADD CONSTRAINT "EngineeringDocument_currentReleasedRevisionId_fkey" FOREIGN KEY ("currentReleasedRevisionId") REFERENCES "EngineeringDocumentRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
