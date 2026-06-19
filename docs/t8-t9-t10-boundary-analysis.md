# T8/T9/T10 服务拆分架构记录

**最后更新**: 2026-06-19
**分支**: `refactor/remaining-tasks`

---

## 一、已拆分服务清单

### FinanceService（原 2303 行 → 现 ~1400 行）

| 子服务 | 文件 | 职责 | 提取方式 |
|--------|------|------|----------|
| FinanceReportsService | finance-reports.service.ts | 试算平衡、总账、损益表、资产负债表、现金流量表 | 既有 |
| FinanceAccountMappingService | finance-account-mapping.service.ts | 财务科目映射 | 既有 |
| AccountingPeriodService | accounting-period.service.ts | 会计期间开关账 | 既有 |
| AccountingService | accounting.service.ts | 凭证过账（日记账生成） | 既有 |
| FinanceDlqService | finance-dlq.service.ts | 财务事件补偿队列 | 既有 |
| FinanceBridgeListener | finance-bridge.listener.ts | 跨模块事件桥接 | 既有 |
| **CustomerStatementService** | customer-statement.service.ts | 客户对账单、客户选项 | **本轮提取** |
| **BankStatementService** | bank-statement.service.ts | 银行流水导入/查询/匹配 | **本轮提取** |
| **FinanceQueryService** | finance-query.service.ts | 发票/贷项/退款/未分配收款列表 | **本轮提取** |

FinanceService 剩余 11 个 public 方法：9 个写操作 + 2 个边缘读操作。

### InventoryService（原 1606 行 → 现 ~830 行）

| 子服务 | 文件 | 职责 | 提取方式 |
|--------|------|------|----------|
| **StockQueryService** | stock-query.service.ts | 库存/仓库/库位/物料/台账/交易/退货/补货 | **本轮提取** |

InventoryService 剩余 9 个 public 方法：全部写操作（发货/入库/出库/冲销）。

### PurchaseService（原 1330 行 → 现 ~850 行）

| 子服务 | 文件 | 职责 | 提取方式 |
|--------|------|------|----------|
| **SupplierStatementService** | supplier-statement.service.ts | 供应商对账单、供应商选项、未结应付 | **本轮提取** |
| **PurchaseQueryService** | purchase-query.service.ts | 供应商付款/贷项列表 | **本轮提取** |
| **purchase-order-read-model** | purchase-order-read-model.ts | 三单匹配计算（纯函数，非 Injectable） | **本轮提取** |
| **purchase-utils** | purchase-utils.ts | 金额工具、日期解析（纯函数） | **本轮提取** |

PurchaseService 剩余 12 个 public 方法：9 个写操作 + 3 个边缘读操作。

---

## 二、停止继续拆分的原因

### 纯查询已基本吃干净

三个 Service 中所有低风险只读查询（无事务、无事件、无跨服务依赖）均已提取。剩余方法分两类：

**写操作（27 个）**：涉及 `$transaction`、EventEmitter2 事件发布、跨模块调用（如 PurchaseService → InventoryService）。提取这些方法需要：
- 明确事务边界归属
- 保持事件发布语义不变
- 处理跨模块依赖注入

这些工作风险高、收益递减，不适合自动化批量处理。

**边缘读操作（5 个）**：
- `getReceivableAging`（Finance）— 纯读但独立性一般
- `getInventoryValuationReconciliation`（Finance）— 跨 3 个服务依赖，风险高
- `listPurchaseOrders` / `getPurchaseOrder` / `getPurchaseOrderMatch`（Purchase）— 依赖共享 helper（purchaseOrderInclude、buildPurchaseMatchSummary），而这些 helper 也被写操作 `postPurchaseInvoice` 使用

### 架构依赖不能反向

如果把 `listPurchaseOrders` 等方法抽到 PurchaseOrderQueryService，写操作 `postPurchaseInvoice`（它也需要 `purchaseOrderInclude` 和 `buildPurchaseMatchSummary`）就必须反向依赖查询服务，这会把架构依赖弄反。

**解决方案**：先将 `purchaseOrderInclude`、`buildPurchaseMatchSummary` 等提取为纯函数（purchase-order-read-model.ts），读写流程都直接调用 helper，不引入服务间依赖。这一步已完成。

### 收益递减

当前 FinanceService 从 2303 行减到 ~1400 行，PurchaseService 从 1330 行减到 ~850 行，InventoryService 从 1606 行减到 ~830 行。继续拆分写操作的边际收益小，但引入的事务/事件风险大。

---

## 三、T13 Prisma enum 迁移前置条件

### 1. 目标字段清单

需要扫描所有 Prisma schema 中使用 `String` 类型但实际值域固定的字段（如 status、type、postingStatus 等）。

### 2. 脏数据扫描

迁移前必须确认现有数据中无非法值。如果有脏数据，migration 会失败。

### 3. Migration 策略

- 使用 Prisma migration 生成 enum 类型
- 使用 `ALTER TABLE ... ALTER COLUMN ... TYPE enum_type USING value::enum_type`
- 分步执行：先加 enum 列、再迁移数据、再删旧列

### 4. 回滚方案

- 保留旧列直到确认迁移成功
- 准备反向 migration 脚本

### 5. Service 层适配

- 替换字符串常量为 enum 引用
- 更新测试中的字符串断言

### 6. 独立分支

T13 enum 迁移必须在独立分支执行，不与服务拆分混做。

---

## 四、提交记录

| Commit | 说明 |
|--------|------|
| `dbc4903` | refactor: 抽取库存只读查询服务 (StockQueryService) |
| `87a92a8` | refactor: extract SupplierStatementService |
| `76ca102` | refactor: extract finance statement services (Customer + Bank) |
| `da7b632` | refactor: extract FinanceQueryService |
| `3943047` | refactor: extract PurchaseQueryService |
| `21c5039` | refactor: extract purchase order read model |

---

## 五、验证基线（2026-06-19）

| 检查项 | 结果 |
|--------|------|
| Prisma validate/generate | ✅ |
| API + Web typecheck | ✅ |
| API lint | 0 errors, 7 warnings（预存） |
| Web lint | 0 errors, 73 warnings（预存） |
| API tests | 37 suites / 372 tests ✅ |
| Web tests | 4 suites / 34 tests ✅ |
| API build | ✅ |
| Web build | ✅ |
