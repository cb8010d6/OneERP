-- Additive only: existing journals retain NULL; no historical attribution/backfill.
ALTER TABLE "JournalEntry" ADD COLUMN "inventoryTransactionId" TEXT;

CREATE UNIQUE INDEX "JournalEntry_companyId_inventoryTransactionId_key"
ON "JournalEntry"("companyId", "inventoryTransactionId");

ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_inventoryTransactionId_fkey"
FOREIGN KEY ("inventoryTransactionId") REFERENCES "InventoryTransaction"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
