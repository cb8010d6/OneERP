# 金额字段 Decimal 迁移审计报告

> **审计日期**: 2026-05-07
> **审计人**: AI Agent
> **目标**: 列出所有金额/税额/借贷字段，区分财务核心字段和非核心估算字段

---

## 1. 财务核心字段（必须迁移为 Decimal）

这些字段涉及真实金额计算，使用 Float 会导致精度丢失（如 0.1 + 0.2 ≠ 0.3）。

### 1.1 销售订单

| 模型 | 字段 | 当前类型 | 目标类型 | 迁移优先级 |
|------|------|----------|----------|------------|
| Order | totalAmount | Float | Decimal(19,4) | P0 |
| Order | subTotal | Float | Decimal(19,4) | P0 |
| Order | taxTotal | Float | Decimal(19,4) | P0 |
| OrderItem | unitPrice | Float | Decimal(19,4) | P0 |
| OrderItem | totalPrice | Float | Decimal(19,4) | P0 |
| OrderItem | subTotal | Float | Decimal(19,4) | P0 |
| OrderItem | taxAmount | Float | Decimal(19,4) | P0 |
| OrderItem | taxRate | Float | Decimal(6,4) | P1 |

### 1.2 发票与付款

| 模型 | 字段 | 当前类型 | 目标类型 | 迁移优先级 |
|------|------|----------|----------|------------|
| Invoice | amount | Float | Decimal(19,4) | P0 |
| Invoice | subTotal | Float | Decimal(19,4) | P0 |
| Invoice | taxAmount | Float | Decimal(19,4) | P0 |
| Invoice | taxRate | Float | Decimal(6,4) | P1 |
| Payment | amount | Float | Decimal(19,4) | P0 |

### 1.3 采购订单

| 模型 | 字段 | 当前类型 | 目标类型 | 迁移优先级 |
|------|------|----------|----------|------------|
| PurchaseOrder | subTotal | Float | Decimal(19,4) | P0 |
| PurchaseOrder | taxTotal | Float | Decimal(19,4) | P0 |
| PurchaseOrder | totalAmount | Float | Decimal(19,4) | P0 |
| PurchaseOrderLine | unitPrice | Float | Decimal(19,4) | P0 |
| PurchaseOrderLine | taxRate | Float | Decimal(6,4) | P1 |
| PurchaseOrderLine | taxAmount | Float | Decimal(19,4) | P0 |
| PurchaseOrderLine | subTotal | Float | Decimal(19,4) | P0 |
| PurchaseOrderLine | totalAmount | Float | Decimal(19,4) | P0 |
| PurchaseOrderLine | receivedQuantity | Float | Decimal(19,4) | P1 |

### 1.4 采购发票

| 模型 | 字段 | 当前类型 | 目标类型 | 迁移优先级 |
|------|------|----------|----------|------------|
| PurchaseInvoice | amount | Float | Decimal(19,4) | P0 |
| PurchaseInvoice | subTotal | Float | Decimal(19,4) | P0 |
| PurchaseInvoice | taxAmount | Float | Decimal(19,4) | P0 |
| PurchaseInvoice | taxRate | Float | Decimal(6,4) | P1 |
| PurchaseInvoiceLine | unitPrice | Float | Decimal(19,4) | P0 |
| PurchaseInvoiceLine | lineTotal | Float | Decimal(19,4) | P0 |
| PurchaseInvoiceLine | subTotal | Float | Decimal(19,4) | P0 |
| PurchaseInvoiceLine | taxAmount | Float | Decimal(19,4) | P0 |
| PurchaseInvoiceLine | taxRate | Float | Decimal(6,4) | P1 |
| VendorBillPayment | amount | Float | Decimal(19,4) | P0 |

### 1.5 会计凭证

| 模型 | 字段 | 当前类型 | 目标类型 | 迁移优先级 |
|------|------|----------|----------|------------|
| JournalEntryLine | debit | Float | Decimal(19,4) | P0 |
| JournalEntryLine | credit | Float | Decimal(19,4) | P0 |

### 1.6 税码

| 模型 | 字段 | 当前类型 | 目标类型 | 迁移优先级 |
|------|------|----------|----------|------------|
| TaxCode | rate | Float | Decimal(6,4) | P1 |

---

## 2. 非核心字段（保持 Float 或低优先级）

这些字段是数量、库存、比例等估算值，Float 精度足够。

| 模型 | 字段 | 说明 | 建议 |
|------|------|------|------|
| Material | unitPrice | 标准成本 | P2 — 参考值，非交易金额 |
| Material | minStock | 最小库存 | 保持 Float |
| BomLine | quantity | BOM 用量 | 保持 Float |
| BomLine | scrapRate | 报废率 | 保持 Float |
| StockQuant | quantity | 库存数量 | P2 — 精度敏感但非金额 |
| InventoryTransaction | quantity | 交易数量 | P2 |
| StockMove | quantity | 移动数量 | P2 |
| StockMove | quantityDone | 完成数量 | P2 |
| GoodsReceiptLine | quantity | 入库数量 | P2 |
| PurchaseOrderLine | quantity | 采购数量 | P2 |

---

## 3. 迁移策略

### 3.1 分批迁移

**第一批（P0 — 核心金额字段）**：
- Order/OrderItem 金额字段
- Invoice/Payment 金额字段
- PurchaseOrder/PurchaseOrderLine 金额字段
- PurchaseInvoice/PurchaseInvoiceLine 金额字段
- VendorBillPayment 金额字段
- JournalEntryLine 借贷字段

**第二批（P1 — 税率和辅助字段）**：
- 所有 taxRate 字段
- TaxCode.rate
- receivedQuantity

**第三批（P2 — 数量字段）**：
- Material.unitPrice
- 库存数量字段（如需要更高精度）

### 3.2 Prisma Schema 变更

```prisma
// 示例：从 Float 迁移到 Decimal
// 迁移前
totalAmount  Float  @default(0)

// 迁移后
totalAmount  Decimal  @default(0)  @db.Decimal(19, 4)
```

### 3.3 数据迁移

```sql
-- Prisma migrate 会自动处理类型变更
-- 但需要验证现有数据不会丢失精度
-- 建议：先在测试环境执行，验证数据完整性
```

### 3.4 DTO/Service 影响

- 所有 DTO 中的 `number` 类型字段需要评估是否改为 `string`（Decimal 在 Prisma 中返回字符串）
- Service 层计算需要使用 `Decimal.js` 或 `Prisma.Decimal` 进行运算
- API 响应中 Decimal 字段序列化为字符串，前端需要相应处理

---

## 4. 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 现有数据精度丢失 | 中 | 迁移前备份，验证转换后数据 |
| 前端类型不兼容 | 中 | 更新 TypeScript 类型定义 |
| 第三方集成受影响 | 低 | API 文档更新 |
| 迁移回滚困难 | 高 | 先在测试环境验证，准备好回滚 SQL |

---

## 5. 建议执行顺序

1. 创建迁移分支 `agent/db/money-decimal-migration`
2. 修改 Prisma Schema（第一批 P0 字段）
3. 生成迁移 SQL
4. 在测试环境执行迁移
5. 更新 DTO 和 Service
6. 补充精度测试
7. PR 合并到 develop

**总计**: P0 字段 24 个，P1 字段 8 个，P2 字段 6 个