-- CreateTable
CREATE TABLE "DocumentSequence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerRequirement" (
    "id" TEXT NOT NULL,
    "requirementNo" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sourceChannel" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "estimatedAmount" DECIMAL(18,4),
    "expectedCloseDate" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementActivity" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "activityType" TEXT NOT NULL DEFAULT 'FOLLOW_UP',
    "content" TEXT NOT NULL,
    "nextFollowUpAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSequence_companyId_documentType_year_key" ON "DocumentSequence"("companyId", "documentType", "year");

-- CreateIndex
CREATE INDEX "DocumentSequence_companyId_year_idx" ON "DocumentSequence"("companyId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRequirement_companyId_requirementNo_key" ON "CustomerRequirement"("companyId", "requirementNo");

-- CreateIndex
CREATE INDEX "CustomerRequirement_companyId_status_updatedAt_idx" ON "CustomerRequirement"("companyId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "CustomerRequirement_companyId_ownerId_nextFollowUpAt_idx" ON "CustomerRequirement"("companyId", "ownerId", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "CustomerRequirement_partnerId_createdAt_idx" ON "CustomerRequirement"("partnerId", "createdAt");

-- CreateIndex
CREATE INDEX "RequirementActivity_companyId_requirementId_createdAt_idx" ON "RequirementActivity"("companyId", "requirementId", "createdAt");

-- CreateIndex
CREATE INDEX "RequirementActivity_createdById_createdAt_idx" ON "RequirementActivity"("createdById", "createdAt");

-- AddForeignKey
ALTER TABLE "DocumentSequence" ADD CONSTRAINT "DocumentSequence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRequirement" ADD CONSTRAINT "CustomerRequirement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRequirement" ADD CONSTRAINT "CustomerRequirement_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRequirement" ADD CONSTRAINT "CustomerRequirement_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementActivity" ADD CONSTRAINT "RequirementActivity_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "CustomerRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementActivity" ADD CONSTRAINT "RequirementActivity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementActivity" ADD CONSTRAINT "RequirementActivity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
