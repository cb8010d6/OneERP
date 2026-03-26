-- AlterTable: 为 StockLocation 添加 parentId 自引用字段，支持仓库树形层级结构
ALTER TABLE "StockLocation" ADD COLUMN "parentId" TEXT;

-- 自引用外键约束
ALTER TABLE "StockLocation" ADD CONSTRAINT "StockLocation_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 复合索引，加速按公司+父节点查询
CREATE INDEX "StockLocation_companyId_parentId_idx" ON "StockLocation"("companyId", "parentId");
