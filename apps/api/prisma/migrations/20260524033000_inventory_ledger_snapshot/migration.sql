CREATE TABLE "InventoryLedgerSnapshot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "netQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "batchCount" INTEGER NOT NULL DEFAULT 0,
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLedgerSnapshot_pkey" PRIMARY KEY ("id")
);

INSERT INTO "InventoryLedgerSnapshot" (
    "id",
    "companyId",
    "locationId",
    "materialId",
    "netQty",
    "batchCount",
    "refreshedAt",
    "createdAt",
    "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    loc."companyId",
    sq."locationId",
    sq."materialId",
    COALESCE(SUM(sq."quantity"), 0),
    COUNT(*) FILTER (WHERE sq."quantity" <> 0),
    NOW(),
    NOW(),
    NOW()
FROM "StockQuant" sq
INNER JOIN "StockLocation" loc ON loc."id" = sq."locationId"
GROUP BY loc."companyId", sq."locationId", sq."materialId";

CREATE UNIQUE INDEX "InventoryLedgerSnapshot_companyId_locationId_materialId_key"
ON "InventoryLedgerSnapshot"("companyId", "locationId", "materialId");

CREATE INDEX "InventoryLedgerSnapshot_companyId_materialId_idx"
ON "InventoryLedgerSnapshot"("companyId", "materialId");

CREATE INDEX "InventoryLedgerSnapshot_companyId_locationId_idx"
ON "InventoryLedgerSnapshot"("companyId", "locationId");

ALTER TABLE "InventoryLedgerSnapshot"
ADD CONSTRAINT "InventoryLedgerSnapshot_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryLedgerSnapshot"
ADD CONSTRAINT "InventoryLedgerSnapshot_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "StockLocation"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryLedgerSnapshot"
ADD CONSTRAINT "InventoryLedgerSnapshot_materialId_fkey"
FOREIGN KEY ("materialId") REFERENCES "Material"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
