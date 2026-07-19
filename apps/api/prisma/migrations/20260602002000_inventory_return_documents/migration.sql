-- CreateTable
CREATE TABLE "InventoryReturnDocument" (
    "id" TEXT NOT NULL,
    "returnNo" TEXT NOT NULL,
    "returnType" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "sourceDocumentNo" TEXT NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "note" TEXT,
    "operatorId" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryReturnDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryReturnLine" (
    "id" TEXT NOT NULL,
    "returnDocumentId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "locationId" TEXT,
    "inventoryMoveId" TEXT,
    "batchNo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryReturnDocument_returnNo_key" ON "InventoryReturnDocument"("returnNo");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryReturnDocument_companyId_referenceNo_key" ON "InventoryReturnDocument"("companyId", "referenceNo");

-- CreateIndex
CREATE INDEX "InventoryReturnDocument_companyId_returnType_postedAt_idx" ON "InventoryReturnDocument"("companyId", "returnType", "postedAt");

-- CreateIndex
CREATE INDEX "InventoryReturnDocument_sourceDocumentNo_idx" ON "InventoryReturnDocument"("sourceDocumentNo");

-- CreateIndex
CREATE INDEX "InventoryReturnLine_returnDocumentId_idx" ON "InventoryReturnLine"("returnDocumentId");

-- CreateIndex
CREATE INDEX "InventoryReturnLine_materialId_idx" ON "InventoryReturnLine"("materialId");

-- CreateIndex
CREATE INDEX "InventoryReturnLine_inventoryMoveId_idx" ON "InventoryReturnLine"("inventoryMoveId");

-- AddForeignKey
ALTER TABLE "InventoryReturnDocument" ADD CONSTRAINT "InventoryReturnDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReturnLine" ADD CONSTRAINT "InventoryReturnLine_returnDocumentId_fkey" FOREIGN KEY ("returnDocumentId") REFERENCES "InventoryReturnDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
