# Phase 2 报价 V1 tracer 实施报告

> 日期：2026-07-11
> 实现提交：`8d4aec2`（`feat: add quote version one tracer`）
> 验收脚本提交：`bb4eb1c`（`test: cover quote v1 in business acceptance`）
> 工作台提交：`fc32bcc`（`feat: add quote creation to requirement workbench`）
> 版本生命周期提交：`bd7871d`（`feat: add quote version lifecycle commands`）
> 生命周期验收提交：`09e0702`（`test: add quote lifecycle acceptance`）
> 工作台生命周期提交：`73091da`（`feat: add quote lifecycle actions to workbench`）
> 范围：客户需求单 -> 报价 V1；不包含 V2、发出、客户决策、合同或转订单

## 1. 已实现

- 新增 `Quote`、`QuoteVersion`、`QuoteVersionItem`，全部显式包含公司作用域。
- 报价编号复用公司级年度原子序列，格式为 `QT-YYYY-######`。
- 一个客户需求单只能有一个报价主单；后续商业变化必须新增版本，不能重复创建主单。
- `POST /presales/requirements/:id/quotes` 从同公司、非终态客户需求创建 V1。
- 客户、负责人和来源需求 ID 从需求单固化，调用方不能覆盖。
- 产品必须属于当前公司且处于启用状态；SKU、名称和 UOM 写入版本明细快照。
- 金额使用 Prisma Decimal 计算并固化净额、税额和含税总额。
- CNY 报价固定保存 `baseCurrencyCode=CNY`、`exchangeRate=1`、`exchangeRateSource=SYSTEM_BASE` 和快照时间。
- 非 CNY 创建当前明确拒绝，等待可替换汇率 provider 后开放，不静默使用旧汇率。
- 创建报价、需求状态进入 `QUOTING` 和 `AuditLog` 写入处于同一数据库事务。
- Admin 与 Sales 角色模板获得相应报价草稿权限；三个新模型加入 Prisma 租户白名单。

## 2. 关键不变量

- `@@unique([companyId, quoteNo])`：公司内报价号唯一。
- `@@unique([companyId, requirementId])`：需求与报价主单一对一。
- `@@unique([quoteId, versionNo])`：同一报价版本号唯一。
- `RequirementActivity` 仍使用普通复合索引，同一需求可追加多条跟进记录。
- 已关闭需求（`LOST`、`CANCELLED`、`CONVERTED`）不能创建报价。
- 同一报价中不能重复出现相同产品。
- 有效期必须晚于创建时间。

## 3. 验证证据

- TDD：首个测试以 `createQuoteFromRequirement is not a function` 失败，完成实现后售前定向测试 9/9 通过。
- `npm run validate`：通过。
  - 脚本测试：2/2。
  - API：41 套件、394 测试。
  - Web：5 套件、35 测试。
  - API/Web typecheck、lint、build 通过；仅保留既有 warnings。
- `npm run compose:config`：dev、easy、HA-lite、prod、prod-2gb-uat 五种组合通过。
- `npm run audit:security`：Root/API/Web 为 0；Mobile 保留既有 9 个 moderate，无 high/critical。
- 空 PostgreSQL 15 成功执行全部 30 个 migration，包括 `20260711002000_presales_quotes`。
- 数据库 smoke：成功创建 `QT-2026-000001 / V1 / DRAFT / CNY / SYSTEM_BASE / 1 item / total 200`。
- PostgreSQL 定向索引检查确认：Quote 的需求复合索引为 UNIQUE；RequirementActivity 的跟进复合索引为普通 INDEX。
- Graphify 更新后：3280 nodes、6638 edges、244 communities。

## 4. 远程 UAT

- UAT 使用 `uat-8d4aec2` 临时离线镜像；API/Web 均健康，PostgreSQL、Redis、MinIO 未重建。
- 远程成功应用 migration `20260711002000_presales_quotes`，数据库当前记录 30 个 migration。
- `.env` 切换前已保留 `before-8d4aec2` 回滚备份。
- `prod-smoke` 的健康、登录、Dashboard、订单、元数据、库存账和 Web API 代理全部通过。
- `business-acceptance.mjs` 已扩展为 11 步并全部通过，报告为 `scripts/business-acceptance-report-bb4eb1c.json`。
- 新增报价验收结果：`REQ-2026-000002 -> QT-2026-000001 / V1 / DRAFT / CNY / SYSTEM_BASE / total 452`。
- 报价步骤之后的采购收货、库存不足拒绝、正常发货、发票过账和试算平衡仍全部通过，证明新 migration 未破坏原有交易链。
- 迁移工具镜像是在远程既有 `uat-d0ee161` builder 镜像上追加本批纯 SQL migration 后生成的临时 overlay；它不是正式 GHCR 发布物。API/Web 镜像由当前工作树本地构建并离线上传。
- 工作台批次已部署为 `uat-fc32bcc`：需求列表返回报价摘要，已报价需求显示报价号、版本、状态、币种和金额；未报价的活跃需求可打开多行报价 Sheet，选择产品并填写数量、单价、税率、有效期和条款。
- `uat-fc32bcc` 部署后 11 步验收再次全部通过，报告为 `scripts/business-acceptance-report-fc32bcc.json`，新增记录为 `REQ-2026-000003 -> QT-2026-000002 / V1 / DRAFT / total 452`。
- GitHub PR #15 在 `fc32bcc` 上的 validate、commitlint 和 CodeQL 全绿；PR 仍为 Draft，未合并。
- 登录页已通过浏览器加载且无控制台错误；报价工作台登录后桌面/移动交互视觉验收仍待完成，不在本报告中提前标记通过。
- 工作台已接入报价生命周期动作：草稿可发出，已发出版本可记录接受/拒绝并创建新版本，拒绝/过期版本可创建新版本；请求期间按钮锁定并在完成后刷新当前摘要。
- `uat-73091da` 已部署 Web 工作台，API 保持 `uat-bd7871d` 生命周期版本；健康检查和 Web HTTP 200 通过。
- 报价版本生命周期已部署为 `uat-bd7871d`，新增独立 `/presales/quotes` 命令接口，支持复制 V2、条件发出和记录客户接受/拒绝。
- V2 创建使用 `currentVersionNo` 条件更新抢占版本号；发出和客户决策均使用状态条件 `updateMany`，并发状态变化返回明确冲突，不依赖数据库异常产生 500。
- 远程生命周期验收通过：`REQ-2026-000004 -> QT-2026-000003 -> V1 SENT -> V2 DRAFT -> V2 SENT -> V2 ACCEPTED`，总额 250。
- PostgreSQL 定向查询确认最终版本状态为 `V1 SUPERSEDED / V2 ACCEPTED`。

## 5. 已知边界与下一批

- 当前工作台已支持创建 V1 和查看当前报价摘要；V2、发出和客户决策 API 已完成，界面按钮仍待下一批接入。
- 当前不允许非 CNY 报价，下一批先定义可替换汇率 provider，再实现明确失败、快照时间和来源。
- 当前未实现 V2、发出后不可修改、接受/拒绝、V1 `SUPERSEDED`；这些必须继续以版本状态测试驱动实现。
- 全仓 `prisma migrate diff` 仍显示早期 migration 与当前 schema 的历史漂移，包括旧表、旧索引和外键差异。报价 migration 已通过空库和定向数据库检查；历史 drift 应作为独立基线治理任务处理，不能通过改写已发布 migration 隐藏。
- 本报告只证明报价 V1 tracer 的本地门禁和远程 UAT，不代表完整售前链或生产就绪。
