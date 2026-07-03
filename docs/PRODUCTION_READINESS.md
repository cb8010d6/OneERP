# OneERP 生产就绪门禁 / Production Readiness

本文档定义真实库存和财务使用前必须满足的门禁。中文为主，英文用于双语审阅。
This document defines the gate for real inventory and finance use.

## 当前决策 / Current Decision

OneERP 在 quickstart 部署通过后，可以用于受控内测或试运行。真实库存或财务生产使用必须通过 HA-lite 门禁、恢复演练和上线清单。

默认生产试运行目标：

- 架构形态 / Architecture：单机 HA-lite。
- 数据保护 / Data protection：先备份恢复，不做热备。
- RPO：15 分钟。
- RTO：1 小时。

## P0：真实生产前必须完成 / Required Before Real Production

- [ ] 待部署精确 commit 上 `npm run validate` 通过。
- [ ] 干净服务器上 `docker compose -f docker-compose.ha-lite.yml up -d --build` 成功。
- [ ] `docker compose -f docker-compose.ha-lite.yml config` 通过。
- [ ] 如使用镜像部署，`docker compose -f docker-compose.prod.yml config` 在生产 `.env` 下通过。
- [ ] `scripts/deploy-check.*` 通过。
- [ ] `scripts/prod-smoke.*` 通过，核心登录、订单、库存、发票接口无 500。
- [ ] `scripts/staff-permission-smoke.*` 通过，员工只读和越权拒绝均可验证。
- [ ] `scripts/business-acceptance.*` 通过，真实业务数据验收报告为 `passed`。
- [ ] `scripts/audit-prod-config.*` 无 P0 问题。
- [ ] `/api/health` 返回 `status: ok`。
- [ ] 管理员登录可用，默认管理员密码已修改。
- [ ] `.env` 密钥为生产唯一值，且未进入 Git。
- [ ] PostgreSQL 至少每 15 分钟备份一次。
- [ ] MinIO 至少每小时备份一次，或在大量文件导入后立即备份。
- [ ] `scripts/restore-drill.*` 已输出通过的 `restore-drill-report.json`。
- [ ] 恢复演练耗时小于 1 小时。
- [ ] 已记录备份位置和恢复负责人。
- [ ] 公网或跨办公区访问已启用 HTTPS。
- [ ] 数据库、Redis、MinIO 端口不对公网开放。
- [ ] `CORS_ORIGINS` 只列出可信 Web 域名。
- [ ] GitHub Dependabot critical/high 漏洞已修复，或已记录接受原因。
- [ ] 至少完成一次接近真实数据的采购收货全流程测试。
- [ ] 至少完成一次接近真实数据的销售发货全流程测试。
- [ ] 至少完成一次凭证过账与冲销场景测试。
- [ ] 财务测试后试算平衡借贷相等。
- [ ] 收货、调拨、发货后，库存流水与预期实物数量一致。

## 镜像生产部署 / Image-Based Production Deployment

`docker-compose.prod.yml` 面向已发布到 GHCR 的镜像部署，不在服务器上构建源码。生产服务器必须准备受控 `.env`，至少包含：

- `IMAGE_PREFIX`：镜像前缀，例如 `your-org/oneerp`，对应 `ghcr.io/your-org/oneerp-api`、`oneerp-api-migrate`、`oneerp-web`。
- `IMAGE_TAG`：默认 `latest`；需要精确回滚时可使用发布镜像 tag。
- `POSTGRES_PASSWORD`、`JWT_SECRET`、`MINIO_SECRET_KEY`、`INIT_ADMIN_EMAIL`、`INIT_ADMIN_PASSWORD`、`CORS_ORIGINS`。
- `NEXT_PUBLIC_API_BASE_URL`：默认 `/api/proxy`；跨域部署时必须改成真实 API 入口。

GitHub Actions 的 `Deploy` workflow 会构建并推送 API、API migration、Web 三个镜像。只有满足以下任一条件时才会执行远端部署：

- repository variable `DEPLOY_ENABLED=true` 且 push 到 `main`。
- 手动运行 workflow，并勾选 `deploy`。需要精确回滚时，在 `image_tag` 输入框填入已发布镜像 tag，例如上一个 commit SHA tag；默认使用 `latest`。

启用 SSH 部署前必须配置：

- repository secrets：`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`。
- repository variable：`DEPLOY_PATH`，指向服务器上的 OneERP 部署目录。
- 如果 GHCR package 是私有的，配置 `GHCR_TOKEN`；否则需提前在服务器上完成 `docker login ghcr.io`。

远端部署目录必须保留生产 `.env`；workflow 会在部署前同步当前 commit 的 `docker-compose.prod.yml`。部署后继续执行 `scripts/deploy-check.*`、`scripts/prod-smoke.*`、`scripts/business-acceptance.*`。

## P1：强烈建议 / Strongly Recommended

- [ ] 增加异地定时备份。
- [ ] 增加 API 和 Web 容器日志保留策略。
- [ ] 增加 Web 和 `/api/health` 可用性监控。
- [ ] 增加 PostgreSQL 和 MinIO 卷磁盘监控。
- [ ] 创建明确业务角色，不能只依赖 `SuperAdmin`。
- [ ] 复核财务和库存使用到的所有权限点。
- [ ] AI 写操作保持关闭；开启前必须完成动作级权限验收和审计抽查。
- [ ] 财务上线前记录期初余额。
- [ ] 按顺序导入主数据：公司、用户、往来单位、会计科目、税码、仓库、库位、物料、产品、期初库存。
- [ ] 试运行会计期间内冻结非必要 schema 变更。

## 库存验收场景 / Inventory Acceptance Scenarios

使用接近真实的 SKU、批次和库位执行：

- 自动验收 / Automated check：`scripts/business-acceptance.*`。
- [ ] 采购收货通过库存流水增加库存。
- [ ] 调拨扣减源库位并增加目标库位。
- [ ] 发货在可用库存不足时拒绝。
- [ ] 发货产生不可变库存流水。
- [ ] 业务更正不直接手工修改库存数量。
- [ ] 库存报表与 `StockQuant` 和交易历史一致。

## 财务验收场景 / Finance Acceptance Scenarios

使用接近真实的会计科目和税码执行：

- 自动验收 / Automated check：`scripts/business-acceptance.*`。
- [ ] 销售发票过账生成借贷平衡凭证。
- [ ] 采购发票过账生成借贷平衡凭证。
- [ ] 冲销生成反向凭证，不删除历史。
- [ ] 试算平衡表借方等于贷方。
- [ ] 税码变更不改写已过账历史凭证。
- [ ] 模拟事件失败后观察到 Finance DLQ 重试。

## 回滚计划 / Rollback Plan

上线前：

1. 使用 `scripts/backup.*` 创建备份。
2. 记录部署的 Git commit。
3. 记录当前 Docker image ID。
4. 在独立环境演练恢复。
5. 明确谁可以批准回滚。

回滚选项：

- 应用回滚 / Application rollback：部署上一个 Git commit 并重建容器。
- 数据回滚 / Data rollback：从已确认可用的备份恢复 PostgreSQL 和 MinIO。

## RPO/RTO 演练记录 / Drill Record

真实生产前和每次重要部署变更后，都要记录演练结果。

| 日期 Date | Commit | 备份 Backup | RPO 数据年龄 | RTO 耗时 | 结果 Result | 负责人 Owner |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |

## 签字 / Sign-off

- 库存负责人 / Inventory owner: `________________`
- 财务负责人 / Finance owner: `________________`
- 运维负责人 / Operations owner: `________________`
- 上线审批人 / Go-live approver: `________________`

加载真实库存或财务数据前，必须完成 [`docs/GO_LIVE_CHECKLIST.md`](./GO_LIVE_CHECKLIST.md)。

## 已知缺口 / Known Gaps

- Prisma schema 中仍有部分金额字段使用 `Float`。高频财务生产前，应将关键金额字段迁移到 Decimal。
- 单机 HA-lite 没有自动故障切换。
- 异地备份依赖 `offsiteDir` 或外部存储配置。
- 前端 lint 仍有 warnings；不阻塞部署，但收紧 CI 前应继续减少。
- GitHub 依赖漏洞告警需要单独做依赖加固迭代。
- 项目领域语言记录在 [`CONTEXT.md`](../CONTEXT.md)，架构决策记录在 [`docs/adr`](./adr)。
