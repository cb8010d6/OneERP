-- OneERP migrated sales orders from Customer to Partner, but older databases can
-- still carry the legacy NOT NULL customerId column. Prisma no longer writes it,
-- so order creation fails until this compatibility cleanup is applied.
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_customerId_fkey";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "customerId";
