-- CreateIndex
CREATE INDEX "Order_companyId_status_idx" ON "Order"("companyId", "status");

-- CreateIndex
CREATE INDEX "Order_companyId_createdAt_idx" ON "Order"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_companyId_status_idx" ON "Invoice"("companyId", "status");

-- CreateIndex
CREATE INDEX "Invoice_companyId_dueDate_idx" ON "Invoice"("companyId", "dueDate");

-- CreateIndex
CREATE INDEX "InventoryTransaction_companyId_createdAt_idx" ON "InventoryTransaction"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryTransaction_companyId_type_createdAt_idx" ON "InventoryTransaction"("companyId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_entity_createdAt_idx" ON "AuditLog"("companyId", "entity", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
