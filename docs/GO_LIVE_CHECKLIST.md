# OneERP 上线清单 / Go-live Checklist

本文档以中文为主，英文仅作为辅助标签。真实库存或财务生产使用前，所有必填项必须完成，并由对应负责人签字。
Chinese is the source of truth. English labels are provided for bilingual review.

## 部署 / Deployment

- [ ] 已部署精确发布 commit：`________________`。
- [ ] 发布 commit 上 `npm run validate` 已通过。
- [ ] `docker compose -f docker-compose.ha-lite.yml config` 已通过。
- [ ] `scripts/deploy-check.*` 已通过。
- [ ] `scripts/audit-prod-config.*` 无 P0 问题。
- [ ] 外网或跨办公区访问已启用 HTTPS。
- [ ] PostgreSQL、Redis、MinIO 端口没有公网暴露。

负责人 / Owner: `________________`

## 访问与安全 / Access And Security

- [ ] 初始管理员密码已修改。
- [ ] 管理员账号负责人已记录。
- [ ] `CORS_ORIGINS` 只包含可信 Web 域名。
- [ ] `.env` 未进入 Git，并已安全备份。
- [ ] JWT、数据库、MinIO、管理员密码均为生产唯一密钥。
- [ ] 真实用户已分配业务角色，不能只依赖 `SuperAdmin`。

负责人 / Owner: `________________`

## 备份与恢复 / Backup And Recovery

- [ ] 备份策略文件已复核。
- [ ] PostgreSQL 定时备份间隔为 15 分钟。
- [ ] MinIO 对象数据已纳入备份。
- [ ] 已配置异地备份，或明确人工复制责任人。
- [ ] 最近一次 `restore-drill-report.json` 状态为 `passed`。
- [ ] 恢复演练耗时小于 1 小时。
- [ ] 已记录恢复负责人和备份位置。

备份位置 / Backup location: `________________`

恢复负责人 / Recovery owner: `________________`

## 库存验收 / Inventory Acceptance

- [ ] 仓库和库位已导入。
- [ ] 物料/产品和期初库存已导入。
- [ ] 采购收货会增加库存，并产生库存流水。
- [ ] 销售发货会扣减库存，库存不足时会拒绝。
- [ ] 调拨会扣减源库位并增加目标库位。
- [ ] 库存更正使用业务冲销/调整流程，不直接改数量。
- [ ] 库存报表与实际期望数量一致。

库存负责人 / Inventory owner: `________________`

## 财务验收 / Finance Acceptance

- [ ] 会计科目表已复核。
- [ ] 默认税码已复核。
- [ ] 默认总账日记账已存在。
- [ ] 期初余额已记录并审批。
- [ ] 销售发票过账会生成借贷平衡凭证。
- [ ] 采购发票过账会生成借贷平衡凭证。
- [ ] 冲销会生成反向凭证，不删除历史凭证。
- [ ] 试算平衡表借贷相等。
- [ ] Finance DLQ 重试已测试或已观察到正常运行。

财务负责人 / Finance owner: `________________`

## 上线决策 / Go / No-go

- [ ] 所有 P0 项已完成。
- [ ] 剩余风险已记录。
- [ ] 回滚审批人已指定。
- [ ] 业务负责人批准上线。

上线审批人 / Go-live approver: `________________`

日期 / Date: `________________`
