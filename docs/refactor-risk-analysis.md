# OneERP 后续重构风险分析

**日期**: 2026-06-30
**分支**: `refactor/remaining-tasks`

本文件只记录后续重构风险和拆批建议，不代表已实施迁移或业务策略变更。

## 自动盘点入口

后续推进 enum 迁移、编号生成器、事件一致性或写操作拆分前，先运行：

```powershell
npm run risk:audit
```

脚本会输出 `remaining-risk-audit-report.json`，盘点 `status/type String` 字段、金额型 `Float` 字段、`Date.now()` 业务编号和直接 `eventEmitter.emit` 调用。报告是只读分析，不会修改数据库或源码。

T13 enum 迁移前，生成只读脏数据扫描 SQL：

```powershell
npm run enum:dirty-sql
```

脚本会输出 `enum-dirty-data-scan.sql`，包含每个 `status/type String` 候选字段的现值分布，以及按 schema 注释或 `@default` 推导的非法值检查。所有非法值查询必须返回零行，才能进入 enum migration 设计。该 SQL 使用 `SET TRANSACTION READ ONLY`，不修改数据库。

## 一、编号生成器碰撞风险

### 1.1 当前生成点

| 位置 | 生成字段 | 当前策略 | Prisma 约束 |
|------|----------|----------|-------------|
| `PurchaseService.generateDocumentNo(prefix)` | purchaseNo / receiptNo / invoiceNo / paymentNo / creditNo | `${prefix}-${Date.now()}` | 对应字段均为 `@unique` |
| `InventoryService.generateReturnNo(returnType)` | returnNo | `${prefix}-${yyyyMMdd}-${Date.now().slice(-6)}` | `returnNo @unique` |
| `InventoryService.generateBatchNo()` | batchNo | `BATCH${Date.now()}` | `StockQuant` 有 `[locationId, materialId, batchNo]` 唯一约束 |
| `FinanceService.createInvoice()` | invoiceNo | `INV-${Date.now()}` | `invoiceNo @unique` |
| `FinanceService.createCreditNote()` | creditNo | `CN-${Date.now()}` | `creditNo @unique` |
| `FinanceService.createCustomerRefund()` | refundNo | `RF-${Date.now()}` | `refundNo @unique` |

### 1.2 风险判断

- `Date.now()` 在同一毫秒内可能重复，数据库唯一约束会兜底失败，但用户会看到创建失败。
- 当前策略没有重试，也没有按公司、业务日期或序列维度表达业务含义。
- 不能直接替换为随机 ID，因为发票、付款、贷项、退货等编号通常会进入对账、审计和客户/供应商沟通场景。

### 1.3 后续方案对比

| 方案 | 优点 | 风险 |
|------|------|------|
| `nanoid(10)` 后缀 | 改动小、无 migration、碰撞概率低 | 编号可读性弱，不能表达连续业务序列 |
| DB sequence / 业务编号表 | 可按公司、日期、单据类型生成连续编号 | 需要 migration、事务封装、并发锁策略和回滚方案 |

**建议**: 短期可加唯一冲突重试；长期应设计业务编号表。实施前需要人类确认编号格式和连续性要求。

## 二、T13 Prisma enum 迁移前置分析

### 2.1 字段清单

| Model | 字段 | 当前注释值 |
|-------|------|------------|
| `Order` | `status` | DRAFT / PENDING / IN_PRODUCTION / SHIPPED / COMPLETED |
| `PurchaseOrder` | `status` | DRAFT / ORDERED / PARTIAL_RECEIVED / RECEIVED / CANCELLED |
| `PurchaseReceipt` | `status` | POSTED / REVERSED |
| `PurchaseInvoice` | `status` | UNPAID / PARTIAL / PAID |
| `Warehouse` | `type` | MATERIAL / FINISHED / PART |
| `InventoryTransaction` | `type` | INBOUND / OUTBOUND / TRANSFER |
| `InventoryReturnDocument` | `status` | POSTED |
| `WorkOrder` | `status` | PENDING / IN_PROGRESS / COMPLETED |
| `Invoice` | `status` | UNPAID / PARTIAL / PAID |
| `CreditNote` | `status` | DRAFT / POSTED / CANCELLED |
| `CustomerRefund` | `status` | DRAFT / POSTED / CANCELLED |
| `SupplierCreditNote` | `status` | DRAFT / POSTED / CANCELLED |
| `Account` | `type` | ASSET / LIABILITY / EQUITY / REVENUE / EXPENSE |
| `EventDlq` | `status` | PENDING |

### 2.2 只读脏数据扫描 SQL

```sql
select 'Order.status' as field, status, count(*) from "Order" group by status;
select 'PurchaseOrder.status' as field, status, count(*) from "PurchaseOrder" group by status;
select 'PurchaseReceipt.status' as field, status, count(*) from "PurchaseReceipt" group by status;
select 'PurchaseInvoice.status' as field, status, count(*) from "PurchaseInvoice" group by status;
select 'Warehouse.type' as field, type, count(*) from "Warehouse" group by type;
select 'InventoryTransaction.type' as field, type, count(*) from "InventoryTransaction" group by type;
select 'InventoryReturnDocument.status' as field, status, count(*) from "InventoryReturnDocument" group by status;
select 'WorkOrder.status' as field, status, count(*) from "WorkOrder" group by status;
select 'Invoice.status' as field, status, count(*) from "Invoice" group by status;
select 'CreditNote.status' as field, status, count(*) from "CreditNote" group by status;
select 'CustomerRefund.status' as field, status, count(*) from "CustomerRefund" group by status;
select 'SupplierCreditNote.status' as field, status, count(*) from "SupplierCreditNote" group by status;
select 'Account.type' as field, type, count(*) from "Account" group by type;
select 'EventDlq.status' as field, status, count(*) from "EventDlq" group by status;
```

### 2.3 推荐迁移顺序

1. 低耦合基础枚举：`Account.type`、`Warehouse.type`
2. 财务/采购结算枚举：`Invoice.status`、`PurchaseInvoice.status`、贷项/退款状态
3. 库存/生产流程枚举：`InventoryTransaction.type`、`WorkOrder.status`
4. 订单/采购订单状态：`Order.status`、`PurchaseOrder.status`
5. 运维型状态：`EventDlq.status`

### 2.4 回滚策略

- 每批只迁移一组业务域，不跨 Finance/Purchase/Inventory 混批。
- 迁移前导出脏数据扫描结果并备份数据库。
- Prisma enum migration 必须与 service 常量替换同批提交。
- 回滚时 enum 字段恢复为 `String`，保留数据原字符串值。

## 三、写操作拆分边界

### 3.1 Purchase 供应商付款

涉及方法：`createSupplierPayment`、`postSupplierPayment`

- 事务边界：创建草稿无显式事务；过账使用 `$transaction` 更新付款和应付发票状态。
- 事件发布：`purchase.supplier_payment.posted` 在事务提交后发送。
- 幂等性：已过账时返回重复处理提示。
- 失败回滚：事务内状态更新可回滚；事务后事件失败不会回滚数据库。
- 结论：适合单独提取 `SupplierPaymentService`，但必须保留 facade，且事件发布策略要单独测试。

### 3.2 Purchase 供应商贷项

涉及方法：`createSupplierCreditNote`、`postSupplierCreditNote`

- 事务边界：创建草稿无显式事务；过账使用 `$transaction` 更新贷项和应付发票状态。
- 事件发布：`purchase.supplier_credit_note.posted` 在事务提交后发送。
- 幂等性：已过账时返回重复处理提示。
- 失败回滚：事务内更新可回滚；事件失败不会回滚数据库。
- 结论：可作为 `SupplierCreditNoteService` 单独批次，不能与付款服务混做。

### 3.3 Finance 应收收款与核销

涉及方法：`recordReceivablePayment`、`applyReceivablePayment`

- 事务边界：创建收款与核销、追加核销与发票状态更新均在 `$transaction` 内。
- 事件发布：`finance.payment.recorded`、`finance.payment.applied` 在事务提交后发送。
- 幂等性：当前依赖业务校验与核销余额控制，没有显式外部幂等键。
- 失败回滚：事务内可回滚；事务后事件失败不会回滚数据库。
- 结论：这两个方法重复度高，但涉及客户、发票、贷项、分配表和事件，适合先抽纯校验/helper，再考虑服务拆分。

### 3.4 Inventory 库存移动与出入库/冲销

涉及方法：`createStockMove`、`postSaleOrderShipment`、`reverseSaleOrderShipment`、`reversePurchaseInbound`

- 事务边界：`createStockMove` 使用 `$transaction` 包装 `executeStockMove`；销售发货逐行事务；冲销循环调用库存移动。
- 事件发布：出库后发送 `inventory.stock_depleted`。
- 幂等性：部分流程通过 referenceNo/count 跳过重复冲销或重复入库。
- 失败回滚：单个事务内可回滚；循环场景可能出现部分成功，需要逐流程确认。
- 结论：暂不拆。应先为 `executeStockMove` 建立更强的单元测试和事务边界说明，再做任何服务拆分。
