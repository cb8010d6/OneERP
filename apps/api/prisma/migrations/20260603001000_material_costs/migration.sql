CREATE TABLE "MaterialCost" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantityOnHand" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "averageCost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "inventoryValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialCost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MaterialCost_companyId_materialId_key" ON "MaterialCost"("companyId", "materialId");
CREATE INDEX "MaterialCost_companyId_idx" ON "MaterialCost"("companyId");
CREATE INDEX "MaterialCost_materialId_idx" ON "MaterialCost"("materialId");

ALTER TABLE "MaterialCost" ADD CONSTRAINT "MaterialCost_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaterialCost" ADD CONSTRAINT "MaterialCost_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;
