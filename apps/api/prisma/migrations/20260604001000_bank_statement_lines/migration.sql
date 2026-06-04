-- CreateEnum
CREATE TYPE "BankStatementLineStatus" AS ENUM ('UNMATCHED', 'MATCHED');

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankAccount" TEXT,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "counterparty" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "externalRef" TEXT,
    "status" "BankStatementLineStatus" NOT NULL DEFAULT 'UNMATCHED',
    "paymentId" TEXT,
    "supplierPaymentId" TEXT,
    "matchedAt" TIMESTAMP(3),
    "matchedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementLine_companyId_externalRef_key" ON "BankStatementLine"("companyId", "externalRef");

-- CreateIndex
CREATE INDEX "BankStatementLine_companyId_status_transactionDate_idx" ON "BankStatementLine"("companyId", "status", "transactionDate");

-- CreateIndex
CREATE INDEX "BankStatementLine_paymentId_idx" ON "BankStatementLine"("paymentId");

-- CreateIndex
CREATE INDEX "BankStatementLine_supplierPaymentId_idx" ON "BankStatementLine"("supplierPaymentId");

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementLine" ADD CONSTRAINT "BankStatementLine_supplierPaymentId_fkey" FOREIGN KEY ("supplierPaymentId") REFERENCES "SupplierPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
