-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "creditNo" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "subTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "receivableAppliedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "refundLiabilityAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxCodeId" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "postingStatus" "EntryPostingStatus" NOT NULL DEFAULT 'DRAFT',
    "postedAt" TIMESTAMP(3),
    "creditDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_creditNo_key" ON "CreditNote"("creditNo");

-- CreateIndex
CREATE INDEX "CreditNote_companyId_creditDate_idx" ON "CreditNote"("companyId", "creditDate");

-- CreateIndex
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- CreateIndex
CREATE INDEX "CreditNote_partnerId_creditDate_idx" ON "CreditNote"("partnerId", "creditDate");

-- CreateIndex
CREATE INDEX "CreditNote_postingStatus_idx" ON "CreditNote"("postingStatus");

-- CreateTable
CREATE TABLE "CustomerRefund" (
    "id" TEXT NOT NULL,
    "refundNo" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "postingStatus" "EntryPostingStatus" NOT NULL DEFAULT 'DRAFT',
    "postedAt" TIMESTAMP(3),
    "refundDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRefund_refundNo_key" ON "CustomerRefund"("refundNo");

-- CreateIndex
CREATE INDEX "CustomerRefund_companyId_refundDate_idx" ON "CustomerRefund"("companyId", "refundDate");

-- CreateIndex
CREATE INDEX "CustomerRefund_creditNoteId_idx" ON "CustomerRefund"("creditNoteId");

-- CreateIndex
CREATE INDEX "CustomerRefund_partnerId_refundDate_idx" ON "CustomerRefund"("partnerId", "refundDate");

-- CreateIndex
CREATE INDEX "CustomerRefund_postingStatus_idx" ON "CustomerRefund"("postingStatus");

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_taxCodeId_fkey" FOREIGN KEY ("taxCodeId") REFERENCES "TaxCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRefund" ADD CONSTRAINT "CustomerRefund_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRefund" ADD CONSTRAINT "CustomerRefund_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRefund" ADD CONSTRAINT "CustomerRefund_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
