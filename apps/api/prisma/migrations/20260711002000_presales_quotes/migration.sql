-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "quoteNo" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "currentVersionNo" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteVersion" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currencyCode" TEXT NOT NULL,
    "baseCurrencyCode" TEXT NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL,
    "exchangeRateAt" TIMESTAMP(3) NOT NULL,
    "exchangeRateSource" TEXT NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "paymentTerms" TEXT,
    "deliveryTerms" TEXT,
    "subtotal" DECIMAL(18,4) NOT NULL,
    "taxTotal" DECIMAL(18,4) NOT NULL,
    "total" DECIMAL(18,4) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuoteVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteVersionItem" (
    "id" TEXT NOT NULL,
    "quoteVersionId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "skuSnapshot" TEXT NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "uomSnapshot" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "discountRate" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(18,8) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL,
    "grossAmount" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuoteVersionItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Quote_companyId_quoteNo_key" ON "Quote"("companyId", "quoteNo");
CREATE UNIQUE INDEX "Quote_companyId_requirementId_key" ON "Quote"("companyId", "requirementId");
CREATE INDEX "Quote_companyId_partnerId_updatedAt_idx" ON "Quote"("companyId", "partnerId", "updatedAt");
CREATE INDEX "Quote_companyId_ownerId_updatedAt_idx" ON "Quote"("companyId", "ownerId", "updatedAt");
CREATE UNIQUE INDEX "QuoteVersion_quoteId_versionNo_key" ON "QuoteVersion"("quoteId", "versionNo");
CREATE INDEX "QuoteVersion_companyId_status_updatedAt_idx" ON "QuoteVersion"("companyId", "status", "updatedAt");
CREATE INDEX "QuoteVersionItem_companyId_quoteVersionId_idx" ON "QuoteVersionItem"("companyId", "quoteVersionId");
CREATE INDEX "QuoteVersionItem_companyId_productId_idx" ON "QuoteVersionItem"("companyId", "productId");

ALTER TABLE "Quote" ADD CONSTRAINT "Quote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "CustomerRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuoteVersion" ADD CONSTRAINT "QuoteVersion_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuoteVersion" ADD CONSTRAINT "QuoteVersion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuoteVersionItem" ADD CONSTRAINT "QuoteVersionItem_quoteVersionId_fkey" FOREIGN KEY ("quoteVersionId") REFERENCES "QuoteVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuoteVersionItem" ADD CONSTRAINT "QuoteVersionItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuoteVersionItem" ADD CONSTRAINT "QuoteVersionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
