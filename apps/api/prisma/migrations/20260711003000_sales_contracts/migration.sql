CREATE TABLE "SalesContract" (
    "id" TEXT NOT NULL,
    "contractNo" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "quoteVersionId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currentVersionNo" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesContract_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesContractVersion" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currencyCode" TEXT NOT NULL,
    "baseCurrencyCode" TEXT NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL,
    "exchangeRateAt" TIMESTAMP(3) NOT NULL,
    "exchangeRateSource" TEXT NOT NULL,
    "total" DECIMAL(18,4) NOT NULL,
    "paymentTerms" TEXT,
    "deliveryTerms" TEXT,
    "effectiveAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesContractVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesContract_companyId_contractNo_key" ON "SalesContract"("companyId", "contractNo");
CREATE UNIQUE INDEX "SalesContract_quoteVersionId_key" ON "SalesContract"("quoteVersionId");
CREATE INDEX "SalesContract_companyId_partnerId_updatedAt_idx" ON "SalesContract"("companyId", "partnerId", "updatedAt");
CREATE INDEX "SalesContract_companyId_status_updatedAt_idx" ON "SalesContract"("companyId", "status", "updatedAt");
CREATE UNIQUE INDEX "SalesContractVersion_contractId_versionNo_key" ON "SalesContractVersion"("contractId", "versionNo");
CREATE INDEX "SalesContractVersion_companyId_status_updatedAt_idx" ON "SalesContractVersion"("companyId", "status", "updatedAt");

ALTER TABLE "SalesContract" ADD CONSTRAINT "SalesContract_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesContract" ADD CONSTRAINT "SalesContract_quoteVersionId_fkey" FOREIGN KEY ("quoteVersionId") REFERENCES "QuoteVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesContract" ADD CONSTRAINT "SalesContract_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesContract" ADD CONSTRAINT "SalesContract_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesContractVersion" ADD CONSTRAINT "SalesContractVersion_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "SalesContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesContractVersion" ADD CONSTRAINT "SalesContractVersion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
