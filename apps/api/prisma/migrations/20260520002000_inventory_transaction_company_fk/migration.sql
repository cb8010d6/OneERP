ALTER TABLE "InventoryTransaction"
  ADD CONSTRAINT "InventoryTransaction_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
