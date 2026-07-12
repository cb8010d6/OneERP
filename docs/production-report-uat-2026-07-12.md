# 原子幂等生产报工 UAT

日期：2026-07-12（Asia/Shanghai）
部署标签：`uat-975883a`
分支：`refactor/remaining-tasks`

## 范围

- 报工记录、工单进度、原料扣减、成品入库、审计日志和库存耗用 outbox 在同一个串行化数据库事务内提交。
- 客户端为每次报工生成幂等键；同键同载荷重试返回原报工，不重复产生库存流水。
- 同一幂等键用于不同载荷时返回冲突。
- 良品数量不得超过工单剩余数量，良品和不良品不能同时为零。
- 生产工作台显示剩余可报数量、原子过账说明和安全重试结果；公共 i18n hook 的翻译函数引用保持稳定，避免表单更新触发工作台重复加载。

## 自动验收

远程 `oneerp_test` UAT 环境执行 `scripts/production-report-acceptance.mjs`：

```text
workOrderNo = WO-20260712-064649
inventoryFailureRolledBack = true
idempotentReplay = true
differentPayloadConflict = true
overReportRejected = true
firstInventoryTransactions = 2
finalActualQty = 2
finalStatus = COMPLETED
finalRawQty = 3
finalFinishedQty = 2
passed = true
```

验收脚本通过真实 API 创建 UAT 仓库、库位、原料、成品物料和默认 BOM，并执行：

1. 原料入库 5 件，创建计划数量为 2 的生产工单。
2. 从空库位提交报工，验证库存失败且工单进度、成品库存均保持为零。
3. 首批报工 1 件，验证产生一笔原料出库和一笔成品入库，库存变为原料 4、成品 1。
4. 使用相同幂等键和载荷重放，验证返回原报工且库存不变。
5. 使用相同幂等键提交不同数量，验证返回 HTTP 409。
6. 超过剩余数量报工，验证返回 HTTP 400 且库存不变。
7. 第二批报工 1 件，验证工单完成，最终原料 3、成品 2。

## 门禁证据

- 干净 PostgreSQL 15 成功应用全部 38 个 migration。
- `npm run validate` 通过：API 45 suites / 433 tests，Web 7 suites / 43 tests。
- API/Web typecheck、lint、生产构建通过；仅保留既有 lint warning。
- `npm run compose:config` 通过全部 Compose 配置。
- migration 容器退出码为 `0`；API、Web、PostgreSQL、Redis、MinIO 全部 healthy。
- Graphify 更新为 3614 nodes、7420 edges、259 communities。

## 边界

- 本批解决报工、库存和工单进度的同库事务一致性与请求幂等。
- 工艺路线、逐工序工时、领退料单、报废单、质量检验和外协工序仍属于 Phase 4 后续切片。
- 该结果是受控 UAT 证据，不替代恢复演练、HTTPS、生产配置审计、权限签字和业务上线批准。
