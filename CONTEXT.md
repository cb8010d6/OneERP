# OneERP 项目上下文 / Project Context

本文档定义 OneERP 的核心业务语言。中文为准，英文仅辅助理解。
Chinese is the source of truth. English labels are only for bilingual review.

## 当前目标 / Current Goal

OneERP 当前目标是从“单机可部署”推进到“真实库存/财务可试生产”。默认架构是单机 HA-lite，不追求多活或自动故障切换；数据保护优先依靠自动备份、恢复演练和清晰回滚。

## 业务域 / Business Domains

- 公司 / Company：租户隔离的基本单位。所有真实业务数据必须绑定公司上下文。
- 账套 / Accounting book：公司下的财务核算范围。当前实现以公司维度承载账套语义。
- 往来单位 / Partner：客户、供应商或两者兼具的业务主体。旧 `Customer` 数据需要映射到 `Partner`。
- 仓库 / Warehouse：库存实物存放地点的上层组织。
- 库位 / StockLocation：库存余额的具体位置，也是 `StockQuant` 的公司隔离入口。
- 物料 / Material：库存核算和出入库的最小物品主数据。
- 产品 / Product：销售、BOM 和生产使用的可销售或可制造对象。

## 库存语言 / Inventory Language

- 采购收货 / Purchase receipt：采购到货后确认入库的业务动作。
- 销售发货 / Sales shipment：销售订单交付时扣减库存的业务动作。
- 调拨 / Stock transfer：从一个库位扣减，并增加到另一个库位。
- 库存流水 / InventoryTransaction：不可变的库存业务记录，用于审计每次增加、扣减、调拨或冲销。
- 库存余额 / StockQuant：某库位、物料、批次的当前数量。不能绕过业务流程直接修改。
- 冲销 / Reversal：用反向业务记录抵消历史错误，不删除历史流水。

## 财务语言 / Finance Language

- 会计科目 / Account：凭证分录使用的科目。
- 日记账 / Journal：凭证所属的业务账簿类别，例如总账、销售、采购或库存。
- 凭证 / JournalEntry：财务过账后的会计记录。
- 凭证分录 / JournalEntryLine：凭证内的借方或贷方行。
- 过账 / Posting：把业务单据转换成不可随意修改的财务凭证。
- 冲销凭证 / Reversal entry：用于抵消已过账凭证的反向凭证。
- 试算平衡 / Trial balance：按会计科目汇总借贷，验证借方合计等于贷方合计。
- 税码 / TaxCode：税率和税务科目配置。税码变更不能改写已过账历史。
- Finance DLQ：财务事件处理失败后的死信队列，必须可重试、可观测。

## 运维语言 / Operations Language

- HA-lite：单机增强部署形态，包含健康检查、自动重启、资源限制、日志轮转、只暴露 Web/API。
- RPO：可接受的数据丢失窗口。当前目标为 15 分钟。
- RTO：可接受的恢复耗时。当前目标为 1 小时。
- 备份策略 / Backup policy：PostgreSQL 默认 15 分钟，MinIO 默认 60 分钟。
- 恢复演练 / Restore drill：在临时环境恢复备份并输出 `restore-drill-report.json`。
- 生产冒烟 / Production smoke：登录、公司上下文、核心页面和核心 API 的最小可用性检查。

## 工程约束 / Engineering Constraints

- 中文优先；文档和页面文案应先满足中文用户，再补英文辅助。
- 不引入 Kubernetes，除非后续 ADR 明确改变部署目标。
- 不绕过 Prisma migration 修改生产数据库。
- 不直接修改库存余额或历史凭证；业务更正必须通过冲销、调整或新流水表达。
- 每个生产缺陷应先建立可重复的反馈环：`npm run validate`、Docker 干净重建、HTTP/API 脚本或浏览器冒烟。
