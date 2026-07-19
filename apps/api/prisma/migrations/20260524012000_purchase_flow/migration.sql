-- Purchase order -> receipt -> accounts payable foundation.
CREATE TABLE "PurchaseOrder" (
  "id" TEXT NOT NULL,
  "purchaseNo" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "buyerId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "totalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "subTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "taxTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "expectedDate" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseOrderLine" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL,
  "receivedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "unitPrice" DECIMAL(18,4) NOT NULL,
  "subTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "totalPrice" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "note" TEXT,

  CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseReceipt" (
  "id" TEXT NOT NULL,
  "receiptNo" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'POSTED',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "operatorId" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseReceiptLine" (
  "id" TEXT NOT NULL,
  "purchaseReceiptId" TEXT NOT NULL,
  "purchaseOrderLineId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL,
  "destLocationId" TEXT,
  "batchNo" TEXT,

  CONSTRAINT "PurchaseReceiptLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseInvoice" (
  "id" TEXT NOT NULL,
  "invoiceNo" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "amount" DECIMAL(18,4) NOT NULL,
  "subTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'UNPAID',
  "postingStatus" "EntryPostingStatus" NOT NULL DEFAULT 'DRAFT',
  "issuedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueDate" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PurchaseInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseOrder_purchaseNo_key" ON "PurchaseOrder"("purchaseNo");
CREATE INDEX "PurchaseOrder_companyId_status_idx" ON "PurchaseOrder"("companyId", "status");
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

CREATE INDEX "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");
CREATE INDEX "PurchaseOrderLine_materialId_idx" ON "PurchaseOrderLine"("materialId");

CREATE UNIQUE INDEX "PurchaseReceipt_receiptNo_key" ON "PurchaseReceipt"("receiptNo");
CREATE INDEX "PurchaseReceipt_companyId_receivedAt_idx" ON "PurchaseReceipt"("companyId", "receivedAt");
CREATE INDEX "PurchaseReceipt_purchaseOrderId_idx" ON "PurchaseReceipt"("purchaseOrderId");

CREATE INDEX "PurchaseReceiptLine_purchaseReceiptId_idx" ON "PurchaseReceiptLine"("purchaseReceiptId");
CREATE INDEX "PurchaseReceiptLine_materialId_idx" ON "PurchaseReceiptLine"("materialId");

CREATE UNIQUE INDEX "PurchaseInvoice_invoiceNo_key" ON "PurchaseInvoice"("invoiceNo");
CREATE INDEX "PurchaseInvoice_companyId_status_idx" ON "PurchaseInvoice"("companyId", "status");
CREATE INDEX "PurchaseInvoice_supplierId_idx" ON "PurchaseInvoice"("supplierId");

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseOrder_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrderLine"
  ADD CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseOrderLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseReceipt"
  ADD CONSTRAINT "PurchaseReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseReceipt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseReceipt_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseReceiptLine"
  ADD CONSTRAINT "PurchaseReceiptLine_purchaseReceiptId_fkey" FOREIGN KEY ("purchaseReceiptId") REFERENCES "PurchaseReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseReceiptLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseReceiptLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseReceiptLine_destLocationId_fkey" FOREIGN KEY ("destLocationId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PurchaseInvoice"
  ADD CONSTRAINT "PurchaseInvoice_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PurchaseInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
