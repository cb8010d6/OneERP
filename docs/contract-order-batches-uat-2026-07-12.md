# 合同分批转销售订单 UAT

日期：2026-07-12（Asia/Shanghai）  
部署标签：`uat-55f9f52`  
分支：`refactor/remaining-tasks`

## 范围

- 生效合同按稳定 `sourceBatchKey` 分批创建销售订单。
- 订单价格、折扣、税率和产品快照取自合同来源报价明细。
- 同一批次键和相同载荷重复提交返回原订单。
- 同一批次键用于不同载荷时拒绝请求。
- 多批订单按来源报价行累计数量，累计值不得超过合同数量。
- 新建和幂等重放均使用稳定事件幂等键发布 `order.created`，允许补偿事件入队失败。
- 订单、合同版本和来源报价行使用限制删除外键，保留业务追溯链。

## 自动验收

在远程 `oneerp_test` UAT 环境的 Compose 内网执行 `scripts/quote-lifecycle-acceptance.mjs`：

```text
REQ-2026-000008
QT-2026-000007
CT-2026-000004
total=100000

PENDING_SALES_MANAGER
-> PENDING_FINANCE_REVIEW
-> PENDING_BUSINESS_REVIEW
-> APPROVED
-> SIGNED
-> ACTIVE

order batch 1 = ORD-2026-3D69A0-000001
order batch 2 = ORD-2026-3D69A0-000002
idempotentReplay = true
overAllocationStatus = 400
passed = true
```

部署后状态：

- migration 容器退出码为 `0`。
- API、Web、PostgreSQL、Redis、MinIO 均为 healthy。
- `/api/health` 返回 `status: ok`。
- `/login` 返回 HTTP 200。

## 本地与 CI 门禁

- `npm run validate`：API 43 suites / 412 tests，Web 5 suites / 38 tests，生产构建通过。
- `npm run compose:config`：dev、easy、HA-lite、prod、prod-2gb-uat 五套配置通过，无字面量 `:latest` 运行时镜像。
- PR #15：commitlint、validate、CodeQL 全部通过。

## 边界

- 本结果是受控 UAT 证据，不等同于生产就绪。
- 真实生产仍需完成备份恢复演练、HTTPS、生产密钥审计、员工权限验收和业务负责人签字。
- 本批订单初始状态为 `DRAFT`，后续履约仍按现有销售订单审批、库存和财务流程执行。
