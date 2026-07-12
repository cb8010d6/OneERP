# 库存整单原子冲销 UAT

日期：2026-07-13（Asia/Shanghai）
部署标签：`uat-52c5c50`
分支：`refactor/remaining-tasks`

## 范围

- 销售出库冲销的重复检查、全部反向入库流水、订单状态回退和销售退货单在同一个 `Serializable` 事务内提交。
- 采购入库冲销的重复检查、全部反向出库流水、采购退货单和库存耗用 outbox 在同一个 `Serializable` 事务内提交。
- 反向流水按原流水创建时间稳定处理；任一行失败时整单回滚，不留下前序行的部分成功。
- 采购冲销产生的库存耗用事件仅在事务提交后派发；失败事务不派发事件。

## 自动验收

远程 `oneerp_test` UAT 环境执行 `scripts/inventory-reversal-acceptance.mjs`：

```text
purchaseNo = ATOMIC-PO-MRI015RR
failedReverseStatus = 409
firstLineRolledBack = true
secondLineStayedEmpty = true
successfulReversalLines = 2
stockClearedAfterSuccess = true
idempotentReplay = true
passed = true
```

验收脚本通过真实 API 执行：

1. 创建独立仓库、库位和两种物料，同一采购单分别入库 2 件和 1 件。
2. 先耗尽第二种物料，再执行整单采购冲销。
3. 验证第二行库存不足返回 HTTP 409，第一种物料仍为 2 件，证明第一行反向出库已回滚。
4. 补回第二种物料，再次冲销，验证生成两条反向流水和采购退货单，两种物料库存均归零。
5. 重复提交相同采购单冲销，验证安全跳过且不重复扣减库存。

## 门禁证据

- `npm run validate` 通过：API 45 suites / 439 tests，Web 7 suites / 44 tests。
- 库存定向测试 20/20 通过，覆盖销售和采购多行冲销的失败边界。
- API/Web typecheck、lint、生产构建通过；仅保留既有 lint warning。
- `npm run compose:config` 通过全部 Compose 配置。
- 远程 migration 容器退出码为 `0`；API、Web、PostgreSQL、Redis、MinIO 全部 healthy。
- Graphify 更新为 3639 nodes、7473 edges、263 communities。

## 边界

- 本批消除现有销售出库冲销和采购入库冲销的循环部分成功风险，不拆分 InventoryService。
- `executeStockMove` 仍是库存写入核心；后续拆分必须继续保留事务客户端注入、事件 outbox 和失败回滚语义。
- 该结果是受控 UAT 证据，不替代恢复演练、HTTPS、生产配置审计、权限签字和业务上线批准。
