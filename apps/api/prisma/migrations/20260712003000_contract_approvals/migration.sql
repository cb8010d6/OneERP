ALTER TABLE "SalesContract"
ADD COLUMN "submittedAt" TIMESTAMP(3),
ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "rejectedAt" TIMESTAMP(3);

CREATE TABLE "SalesContractApproval" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesContractApproval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SalesContractApproval_companyId_contractId_createdAt_idx" ON "SalesContractApproval"("companyId", "contractId", "createdAt");
CREATE INDEX "SalesContractApproval_actorId_createdAt_idx" ON "SalesContractApproval"("actorId", "createdAt");

ALTER TABLE "SalesContractApproval" ADD CONSTRAINT "SalesContractApproval_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "SalesContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesContractApproval" ADD CONSTRAINT "SalesContractApproval_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesContractApproval" ADD CONSTRAINT "SalesContractApproval_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
