# 默认销售发货整单原子 UAT

日期：2026-07-13（Asia/Shanghai）
部署标签：`uat-1c000e7`
分支：`refactor/remaining-tasks`

## 范围

- 默认 `allowPartial=false` 时，全部销售发货库存流水、订单状态和库存耗用 outbox 在同一个 `Serializable` 事务内提交。
- 任一产品或批次在实际扣减时失败，整笔请求回滚，不留下前序产品的库存流水、订单状态或已派发事件。
- 库存耗用事件在事务内入队，仅在事务提交后派发。
- 显式 `allowPartial=true` 继续保留按行成功/跳过的业务语义，不被本批改变。

## 自动验收

远程 `oneerp_test` UAT 环境执行 `scripts/inventory-shipment-acceptance.mjs`：

```text
orderNo = ORD-202607-6341
failedShipmentStatus = 409
stockRolledBack = true
orderStatusRolledBack = true
noPartialTransactions = true
successfulShipmentLines = 2
stockClearedAfterSuccess = true
finalOrderStatus = SHIPPED
passed = true
```

验收脚本通过真实 API 执行：

1. 创建两个产品并让它们共享同一库存物料，订单两行各请求发货 1 件。
2. 初始库存仅 1 件，使两行预检各自通过，但事务中第二行发生库存竞争失败。
3. 验证请求返回 HTTP 409，库存仍为 1、订单仍为 `DRAFT`，且不存在该订单的部分出库流水。
4. 再入库 1 件并重试，验证两行同时过账、库存归零、产生两条出库流水且订单变为 `SHIPPED`。

## 门禁证据

- `npm run validate` 通过：API 45 suites / 440 tests，Web 7 suites / 44 tests。
- 库存定向测试 21/21 通过，覆盖默认多行发货的后序失败回滚。
- API/Web typecheck、lint、生产构建通过；仅保留既有 lint warning。
- `npm run compose:config` 通过全部 Compose 配置。
- 远程 migration 容器退出码为 `0`；API、Web、PostgreSQL、Redis、MinIO 全部 healthy。
- Graphify 更新为 3656 nodes、7494 edges、278 communities。

## 边界

- 本批只收紧默认整单发货语义；显式部分发货仍允许部分成功并返回 `skippedLines`。
- 本批未拆分 InventoryService，也未新增库存或订单状态。
- 该结果是受控 UAT 证据，不替代恢复演练、HTTPS、生产配置审计、权限签字和业务上线批准。
