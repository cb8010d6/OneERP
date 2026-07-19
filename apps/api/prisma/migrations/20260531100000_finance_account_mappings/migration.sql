CREATE TABLE "FinanceAccountMapping" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FinanceAccountMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinanceAccountMapping_companyId_key_key"
  ON "FinanceAccountMapping"("companyId", "key");
CREATE INDEX "FinanceAccountMapping_companyId_idx"
  ON "FinanceAccountMapping"("companyId");
CREATE INDEX "FinanceAccountMapping_accountId_idx"
  ON "FinanceAccountMapping"("accountId");

ALTER TABLE "FinanceAccountMapping"
  ADD CONSTRAINT "FinanceAccountMapping_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FinanceAccountMapping"
  ADD CONSTRAINT "FinanceAccountMapping_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
