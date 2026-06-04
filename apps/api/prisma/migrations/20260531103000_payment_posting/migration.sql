-- Add company scope and posting state to customer payments.
ALTER TABLE "Payment"
ADD COLUMN "companyId" TEXT,
ADD COLUMN "postingStatus" "EntryPostingStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "postedAt" TIMESTAMP(3);

UPDATE "Payment" AS payment
SET "companyId" = invoice."companyId"
FROM "Invoice" AS invoice
WHERE payment."invoiceId" = invoice."id";

ALTER TABLE "Payment" ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Payment_companyId_paymentDate_idx" ON "Payment"("companyId", "paymentDate");
CREATE INDEX "Payment_invoiceId_postingStatus_idx" ON "Payment"("invoiceId", "postingStatus");
