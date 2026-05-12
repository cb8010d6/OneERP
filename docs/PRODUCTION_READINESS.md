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
- [ ] `scripts/deploy-check.*` 通过。
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

## P1：强烈建议 / Strongly Recommended

- [ ] 增加异地定时备份。
- [ ] 增加 API 和 Web 容器日志保留策略。
- [ ] 增加 Web 和 `/api/health` 可用性监控。
- [ ] 增加 PostgreSQL 和 MinIO 卷磁盘监控。
- [ ] 创建明确业务角色，不能只依赖 `SuperAdmin`。
- [ ] 复核财务和库存使用到的所有权限点。
- [ ] 财务上线前记录期初余额。
- [ ] 按顺序导入主数据：公司、用户、往来单位、会计科目、税码、仓库、库位、物料、产品、期初库存。
- [ ] 试运行会计期间内冻结非必要 schema 变更。

## 库存验收场景 / Inventory Acceptance Scenarios

使用接近真实的 SKU、批次和库位执行：

- [ ] 采购收货通过库存流水增加库存。
- [ ] 调拨扣减源库位并增加目标库位。
- [ ] 发货在可用库存不足时拒绝。
- [ ] 发货产生不可变库存流水。
- [ ] 业务更正不直接手工修改库存数量。
- [ ] 库存报表与 `StockQuant` 和交易历史一致。

## 财务验收场景 / Finance Acceptance Scenarios

使用接近真实的会计科目和税码执行：

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
