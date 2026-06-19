# T8/T9/T10 服务拆分架构记录

**最后更新**: 2026-06-19
**分支**: `refactor/remaining-tasks`

---

## 一、已完成服务拆分

### 本轮提取的子服务

| 子服务 | 模块 | 提取内容 | Commit |
|--------|------|----------|--------|
| StockQueryService | Inventory | 8 个只读查询（库存/仓库/库位/物料/台账/交易/退货/补货） | `dbc4903` |
| SupplierStatementService | Purchase | 3 个只读方法（供应商对账单/选项/未结应付）+ purchase-utils.ts（6 个纯函数） | `87a92a8` |
| CustomerStatementService | Finance | 2 个只读方法（客户对账单/选项），`parseFinanceDate` 内联 | `76ca102` |
| BankStatementService | Finance | 4 个方法（导入/查询/自动匹配/手动匹配）+ findMatchCandidates | `76ca102` |
| FinanceQueryService | Finance | 4 个分页列表（发票/贷项/退款/未分配收款） | `da7b632` |
| PurchaseQueryService | Purchase | 2 个列表查询（供应商付款/贷项） | `3943047` |
| purchase-order-read-model.ts | Purchase | 纯函数：`purchaseOrderInclude`、`withPurchaseMatch`、`buildPurchaseMatchSummary`、`PurchaseMatchStatus`、`PurchaseOrderForMatch` 类型 | `21c5039` |

### 死代码清理（待提交）

| 变更 | 文件 | 内容 |
|------|------|------|
| 删除 4 个未使用私有方法 | finance.service.ts | `incomeStatementAmount`、`balanceSheetAmount`、`accountBalanceEffect`、`cashFlowCategory`（finance-reports.service.ts 中有同名在用副本） |
| 删除未使用私有方法 | inventory.service.ts | `resolveShipmentStockCandidate`（无调用方） |
| 标记 no-op 方法 | inventory.service.ts | `approveAndDeductStock` 加 JSDoc `@deprecated`（controller 端点保留） |

---

## 二、当前边界

### FinanceService（原 2303 行 → 现 1824 行）

**已拆子服务（9 个）：** FinanceReportsService、FinanceAccountMappingService、AccountingPeriodService、AccountingService、FinanceDlqService、FinanceBridgeListener（既有）+ CustomerStatementService、BankStatementService、FinanceQueryService（本轮）

**Facade 委托（15 个）：** listCustomerOptions、getCustomerStatement → CustomerStatementService；importBankStatementLines、getBankStatementLines、autoMatchBankStatementLines、matchBankStatementLine → BankStatementService；getInvoices、getUnappliedPayments、getCreditNotes、getCustomerRefunds → FinanceQueryService；getTrialBalance、getGeneralLedger、getIncomeStatement、getBalanceSheet、getCashFlowStatement → FinanceReportsService

**仍在 FinanceService（10 个）：**
- 写操作（9 个）：createInvoice、recordPayment、recordReceivablePayment、applyReceivablePayment、createCreditNote、postCreditNote、createCustomerRefund、postCustomerRefund、postInvoice
- 读操作（1 个）：getReceivableAging

### InventoryService（原 1606 行 → 现 1453 行）

**已拆子服务（1 个）：** StockQueryService（本轮）

**Facade 委托（8 个）：** getCompanyStocks、getWarehouses、getLocations、getMaterials、getReplenishmentSuggestions、getTransactions、getReturnDocuments、getRealtimeLedger → StockQueryService

**仍在 InventoryService（9 个）：** 全部写操作 — postSaleOrderShipment、createStockMove、createStockMoveInTransaction、createInbound、scanAndCreateOutboundRequest、approveAndDeductStock（deprecated）、postPurchaseInbound、reverseSaleOrderShipment、reversePurchaseInbound

### PurchaseService（原 1330 行 → 现 850 行）

**已拆（4 个）：** SupplierStatementService、PurchaseQueryService（本轮）+ purchase-order-read-model.ts、purchase-utils.ts（纯函数）

**Facade 委托（5 个）：** listSupplierOptions、getSupplierStatement、listOpenPayables → SupplierStatementService；listSupplierCreditNotes、listSupplierPayments → PurchaseQueryService

**仍在 PurchaseService（12 个）：**
- 写操作（9 个）：createPurchaseOrder、receivePurchaseOrder、createPurchaseInvoice、postPurchaseInvoice、bulkPostPurchaseInvoices、createSupplierPayment、postSupplierPayment、createSupplierCreditNote、postSupplierCreditNote
- 读操作（3 个）：listPurchaseOrders、getPurchaseOrder、getPurchaseOrderMatch

---

## 三、停止继续拆写流程的原因

### 1. 纯查询已提取完毕

三个 Service 中所有低风险只读查询（无事务、无事件、无跨服务依赖）均已提取。剩余 27 个写操作涉及 `$transaction`、EventEmitter2 事件发布、跨模块调用。

### 2. 架构依赖不能反向

Purchase 的 `listPurchaseOrders` 等读方法依赖 `purchaseOrderInclude` 和 `buildPurchaseMatchSummary`，而写操作 `postPurchaseInvoice` 也依赖这两个 helper。如果将读方法抽到独立查询服务，写操作就必须反向依赖查询服务，架构依赖会变反。已通过提取纯函数（purchase-order-read-model.ts）解决此问题，读写都直接调用 helper。

### 3. 收益递减

当前三个 Service 行数已大幅缩减（Finance -21%、Inventory -9%、Purchase -36%）。继续拆分写操作的边际收益小，但事务/事件风险大。

---

## 四、剩余高风险项

### 4.1 写操作拆分（需独立分支）

| Service | 候选方法 | 风险点 |
|---------|---------|--------|
| Inventory | postSaleOrderShipment（300 行）、reverseSaleOrderShipment | 事务 + 事件 + 跨模块依赖 |
| Inventory | createStockMove（核心引擎） | 被所有写操作调用，提取会引入大量依赖 |
| Purchase | createSupplierPayment、postSupplierPayment | 复杂校验 + 事务 + 事件 |
| Purchase | postPurchaseInvoice | 使用 buildPurchaseMatchSummary（已提取为纯函数），但仍有事务 |
| Finance | recordPayment、recordReceivablePayment、applyReceivablePayment | 事务 + 事件 |
| Finance | createCreditNote、postCreditNote | 事务 + 事件 + 跨模块（退货单关联） |

### 4.2 T13 Prisma enum 迁移（需独立分支）

- 目标：~12 个 enum 类型，~19 个字段 / 16 个 Model，~350+ 处字符串字面量替换
- 前置条件：脏数据扫描、分批 migration 策略、回滚方案
- 高优先级 enum：OrderStatus、InventoryTransactionType、AccountType、InvoicePaymentStatus、PurchaseOrderStatus、PaymentMethod
- 不能与服务拆分混做

### 4.3 ID 生成器碰撞风险

以下方法使用 `Date.now()` 生成文档编号，并发场景存在碰撞可能：
- `PurchaseService.generateDocumentNo()`
- `InventoryService.generateReturnNo()`、`generateBatchNo()`

需业务确认修复方案（nanoid vs DB sequence），当前不修改。

### 4.4 no-op 端点

`InventoryService.approveAndDeductStock()` 返回硬编码消息"当前版本已改为过账即生效，无需审批"，controller 端点仍存在。已加 JSDoc `@deprecated` 标记，后续版本可移除。

### 4.5 死代码（已识别，待提交）

- finance.service.ts 中 4 个私有方法是 finance-reports.service.ts 同名方法的未使用副本
- inventory.service.ts 中 `resolveShipmentStockCandidate` 无调用方

---

## 五、提交记录

| Commit | 说明 | 状态 |
|--------|------|------|
| `dbc4903` | refactor: 抽取库存只读查询服务 (StockQueryService) | 已提交 |
| `87a92a8` | refactor: extract SupplierStatementService | 已提交 |
| `76ca102` | refactor: extract finance statement services (Customer + Bank) | 已提交 |
| `da7b632` | refactor: extract FinanceQueryService | 已提交 |
| `3943047` | refactor: extract PurchaseQueryService | 已提交 |
| `21c5039` | refactor: extract purchase order read model | 已提交 |
| `2f16410` | docs: document service extraction boundaries | 已提交 |
| `d75ef2e` | refactor: remove dead service code | 已提交 |

---

## 六、验证基线（2026-06-19）

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

---

## 七、后续推荐顺序

1. **当前 PR 收口**：已提交的服务拆分 commits + 死代码清理
2. **类型去重**（独立批次）：finance.types.ts、inventory.types.ts 消除重复类型定义
3. **写操作拆分**（独立分支，逐服务 PR）：从风险最低的开始（Purchase supplier-payment、supplier-credit-note）
4. **T13 Prisma enum**（独立分支）：脏数据扫描 → 分批 migration → Service 层适配
5. **ID 生成器修复**（需业务确认）：nanoid vs DB sequence
