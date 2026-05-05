# 🔄 OneERP 领域流转图 (Domain Flow)

> 最后更新：2026-05-05 · 版本：1.0.0
> 维护人：项目总结构师

---

## 1. 采购流程 (Purchase Flow)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  创建采购单  │────▶│  供应商确认  │────▶│  采购入库    │────▶│  采购发票    │
│  (手动/API)  │     │  (手动)     │     │  (自动过账)  │     │  (财务模块)  │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                              │
                                              ▼
                                    ┌──────────────────┐
                                    │ inventoryService  │
                                    │ .postPurchaseInbound()
                                    │                   │
                                    │ INBOUND 过账:     │
                                    │ ├─ StockQuant     │
                                    │ │  (dest += qty)  │
                                    │ └─ InventoryTransaction
                                    │    type=INBOUND   │
                                    └──────────────────┘
```

### 采购入库过账明细

```
POST /api/inventory/posting/purchase/inbound
Body: { purchaseNo, materialId, destLocationId, quantity, batchNo? }

执行逻辑:
1. 生成 referenceNo = "PURCHASE-IN-{purchaseNo}"
2. 幂等检查: 若已有同 referenceNo 的 INBOUND 记录则跳过
3. 调用 createStockMove() 执行入库
4. 返回 transactionId
```

### 采购入库冲销明细

```
POST /api/inventory/posting/purchase/:purchaseNo/reverse

执行逻辑:
1. 生成 reverseReferenceNo = "PURCHASE-IN-REV-{purchaseNo}"
2. 幂等检查: 若已有冲销记录则跳过
3. 查询原始入库记录, 逐行生成反向出库
4. 返回 reversedLines[]
```

---

## 2. 库存流程 (Inventory Flow)

### 2.1 复式库存过账模型

所有库存变动统一通过 `InventoryService.createStockMove()` 执行:

```
createStockMove(input)
    │
    ├── sourceLocationId 存在?
    │       │
    │       ├── YES → reserveSourceStock()
    │       │         ├─ 批次指定? → 按批次扣减
    │       │         └─ 批次未指定? → FIFO (先进先出, 最多3次)
    │       │         └─ 库存不足? → ConflictException
    │       │
    │       └─ 确定 finalBatchNo
    │
    ├── destLocationId 存在?
    │       │
    │       ├── YES → StockQuant.upsert()
    │       │         ├─ 存在 → quantity += input.quantity
    │       │         └─ 不存在 → 创建新记录
    │       │
    │       └─ 确定 destinationBatch
    │
    ├── 判断 moveType:
    │       ├─ source + dest → "TRANSFER"
    │       ├─ source only  → "OUTBOUND"
    │       └─ dest only    → "INBOUND"
    │
    └── 创建 InventoryTransaction 记录
```

### 2.2 库存事件链

```
OUTBOUND 过账完成
       │
       ▼
inventory.stock_depleted 事件发射
       │
       ├──▶ FinanceBridgeListener.onStockDepleted()
       │    └─ 自动生成会计凭证:
       │       借: 6401 主营业务成本
       │       贷: 1405 库存商品
       │
       └──▶ (可扩展) 低库存预警通知

---

## 3. 销售流程 (Sales / Order Flow)

### 3.1 订单状态机

```
    ┌───────┐  submit   ┌─────────┐  start_production  ┌──────────────┐
    │ DRAFT │──────────▶│ PENDING │──────────────────▶│ IN_PRODUCTION│
    └───────┘           └─────────┘                    └──────────────┘
        │                    │                              │
        │ cancel             │ cancel                       │ ship
        ▼                    ▼                              ▼
    ┌───────────┐      ┌───────────┐                  ┌─────────┐  complete  ┌───────────┐
    │ CANCELLED │      │ CANCELLED │                  │ SHIPPED │──────────▶│ COMPLETED │
    └───────────┘      └───────────┘                  └─────────┘           └───────────┘

    IN_PRODUCTION ──cancel──▶ CANCELLED
    SHIPPED ──cancel──▶ CANCELLED
```

### 3.2 订单创建事件链

```
POST /api/orders
Body: { partnerId, items[], taxCodeId?, expectedDate?, notes? }
       │
       ▼
OrdersService.createOrder()
       │
       ├─ 自动生成 orderNo = "ORD-{YYYYMM}-{####}"
       ├─ 税额计算: calcTaxBreakdown(baseAmount, taxRate, isTaxInclusive)
       ├─ 写入 Order + OrderItem
       │
       └─ EventQueueService.publish("order.created")
              │
              ▼
       OrderCreatedListener.onOrderCreated()
              │
              ├─ 遍历订单明细 → Product → Material
              ├─ 聚合 StockQuant 可用量
              │
              └─ 库存不足? → 写入 AuditLog (SYSTEM_LOW_STOCK_ALERT)
```

### 3.3 订单发货事件链

```
WorkflowService.transition("order", orderId, "ship")
       │
       ├─ 状态校验: IN_PRODUCTION → SHIPPED
       ├─ 更新 Order.status = "SHIPPED"
       ├─ 写入 AuditLog
       │
       └─ 发射事件: workflow.action.sale_order.shipped
              │
              ▼
       OrderWorkflowListener.onSaleOrderShipped()
              │
              ▼
       InventoryService.postSaleOrderShipment()
              │
              ├─ 遍历 OrderItem → Product → Material
              ├─ 幂等检查: referenceNo = "SALE-SHIP-{orderNo}"
              ├─ 逐物料执行 executeStockMove() (OUTBOUND)
              │
              └─ 逐物料发射 inventory.stock_depleted
                     │
                     ▼
              FinanceBridgeListener → 自动记账凭证
```

---

## 4. 财务流程 (Finance Flow)

### 4.1 发票与收款

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  创建发票     │────▶│  发票过账     │────▶│  记录收款     │
│  UNPAID      │     │  POSTED      │     │  PAID/PARTIAL│
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │
       │                    ▼
       │           finance.invoice.posted 事件
       │                    │
       │                    ▼
       │           FinanceBridgeListener.onInvoicePosted()
       │           ┌──────────────────┐
       │           │ 自动记账凭证:    │
       │           │ 借: 1122 应收账款│
       │           │ 贷: 6001 主营收入│
       │           │ 贷: 222101 销项税│
       │           └──────────────────┘
       ▼
  发票过账时自动补算税额 (若 subTotal=0, taxAmount=0)
```

### 4.2 自动记账凭证明细

| 触发事件               | 凭证类型 | 借方科目        | 贷方科目          | 金额计算          |
| ---------------------- | -------- | --------------- | ----------------- | ----------------- |
| `inventory.stock_depleted` | INV (库存) | 6401 主营业务成本 | 1405 库存商品     | unitCost × quantity |
| `finance.invoice.posted`   | SAL (销售) | 1122 应收账款   | 6001 主营业务收入 | invoice.subTotal  |
| `finance.invoice.posted`   | SAL (销售) | —              | 222101 应交税费-销项税 | invoice.taxAmount |

### 4.3 凭证生成规则 (`AccountingService.createBalancedEntry`)

1. 确保默认账簿存在 (GEN / General Journal)
2. 获取 `pg_advisory_xact_lock` 防并发
3. 校验借贷平衡: `totalDebit === totalCredit`
4. 校验每行分录: 仅借方或仅贷方, 金额 >= 0
5. upsert 账户 (Account) 按 `(companyId, code)`
6. 创建 JournalEntry + JournalEntryLine
7. 标记 `postingStatus = POSTED`

### 4.4 失败重试 (FinanceDlqService)

```
记账失败 → FinanceDlqService.recordFailure()
    → 写入 EventDlq 表 (PENDING), nextRetryAt = now + 60s
    → 定时任务 retryPending() 扫描并重试
    → 成功 → RESOLVED / 失败 → 指数退避, 最终 FAILED
```

---

## 5. 生产流程 (Production Flow)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  创建工单     │────▶│  开始生产     │────▶│  报工完成     │
│  PENDING     │     │  IN_PROGRESS │     │  COMPLETED   │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │
       │                    ▼
       │           submitWorkReport(goodQty, defectQty)
       │                    │
       │                    ▼
       │           WorkOrder 状态更新
       │           actualQty += goodQty
       │           actualQty >= plannedQty → COMPLETED
```

---

## 6. 跨模块数据流全景图

```
┌─────────┐   order.created   ┌──────────────┐   stock_depleted   ┌──────────────┐
│  Orders │──────────────────▶│  Inventory   │──────────────────▶│   Finance    │
│         │                   │              │                   │              │
│ CREATE  │                   │ 资源预留      │                   │ 自动凭证     │
│ SUBMIT  │                   │ StockQuant   │                   │ JournalEntry │
│ SHIP    │─────事件──────────▶│ Transaction  │─────事件──────────▶│ Account      │
│ CANCEL  │                   │              │                   │              │
└─────────┘                   └──────────────┘                   └──────────────┘
     │                               │                                  │
     ▼                               ▼                                  ▼
┌──────────────┐           ┌──────────────┐                   ┌──────────────┐
│  AuditLog    │           │  AuditLog    │                   │  AuditLog    │
│  (状态变更)   │           │  (库存变动)   │                   │  (财务凭证)   │
└──────────────┘           └──────────────┘                   └──────────────┘
```
```