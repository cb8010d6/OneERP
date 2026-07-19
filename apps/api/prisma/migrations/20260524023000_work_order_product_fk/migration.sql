ALTER TABLE "WorkOrder"
ADD CONSTRAINT "WorkOrder_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "WorkOrder_productId_idx" ON "WorkOrder"("productId");
