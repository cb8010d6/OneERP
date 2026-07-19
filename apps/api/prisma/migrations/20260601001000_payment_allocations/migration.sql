-- Split customer receipts from invoice settlement so one payment can reconcile
-- one or more receivable invoices.
ALTER TABLE "Payment" ADD COLUMN "partnerId" TEXT;

UPDATE "Payment" AS payment
SET "partnerId" = ord."partnerId"
FROM "Invoice" AS invoice
JOIN "Order" AS ord ON ord."id" = invoice."orderId"
WHERE payment."invoiceId" = invoice."id";

ALTER TABLE "Payment" ALTER COLUMN "partnerId" SET NOT NULL;
ALTER TABLE "Payment" ALTER COLUMN "invoiceId" DROP NOT NULL;

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_partnerId_fkey"
FOREIGN KEY ("partnerId") REFERENCES "Partner"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PaymentAllocation" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "amount" DECIMAL(18,4) NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

INSERT INTO "PaymentAllocation" (
  "id",
  "paymentId",
  "invoiceId",
  "amount",
  "companyId",
  "updatedAt"
)
SELECT
  payment."id",
  payment."id",
  payment."invoiceId",
  payment."amount",
  payment."companyId",
  CURRENT_TIMESTAMP
FROM "Payment" AS payment
WHERE payment."invoiceId" IS NOT NULL;

ALTER TABLE "PaymentAllocation"
ADD CONSTRAINT "PaymentAllocation_paymentId_fkey"
FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentAllocation"
ADD CONSTRAINT "PaymentAllocation_invoiceId_fkey"
FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentAllocation"
ADD CONSTRAINT "PaymentAllocation_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "PaymentAllocation_paymentId_invoiceId_key"
ON "PaymentAllocation"("paymentId", "invoiceId");

CREATE INDEX "PaymentAllocation_companyId_invoiceId_idx"
ON "PaymentAllocation"("companyId", "invoiceId");

CREATE INDEX "PaymentAllocation_invoiceId_idx"
ON "PaymentAllocation"("invoiceId");

CREATE INDEX "Payment_partnerId_paymentDate_idx"
ON "Payment"("partnerId", "paymentDate");
