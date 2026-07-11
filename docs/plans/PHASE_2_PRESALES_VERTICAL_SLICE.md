# Phase 2 售前到订单纵向切片技术边界

> 状态：客户需求、报价 V1/V2、发出与客户决策 API 已完成本地及远程 UAT；报价工作台已部署，登录后响应式视觉验收及 V2/决策按钮待完成；合同切片待实施
> 业务输入：[`PHASE_1_BUSINESS_SEMANTICS.md`](./PHASE_1_BUSINESS_SEMANTICS.md)  
> 目标：以最小可审计链路实现“客户需求 -> 报价版本 -> 合同版本 -> 销售订单”，不扩张为完整 CRM、电子签章或通用流程平台。

## 0. 2026-07-11 实施证据

详细记录：[`PHASE_2_REQUIREMENT_TRACER_REPORT.md`](./PHASE_2_REQUIREMENT_TRACER_REPORT.md)。

报价 V1 记录：[`PHASE_2_QUOTE_V1_TRACER_REPORT.md`](./PHASE_2_QUOTE_V1_TRACER_REPORT.md)。

- 实现提交：`d0ee161`（`feat: add customer requirement tracer`）。
- 新增 `DocumentSequence`、`CustomerRequirement`、`RequirementActivity`，以及公司级索引、外键和 Prisma 租户白名单。
- 单号使用数据库原子年度序列，格式为 `REQ-YYYY-######`，不复用随机四位订单号逻辑。
- API 已覆盖创建、分页/搜索、追加不可变跟进、丢单/取消关闭；写动作在同一事务内写业务记录和 `AuditLog`。
- Web 新增 `/dashboard/sales/requirements`，支持列表、搜索、状态筛选、创建、跟进和标记丢单。
- 本地空 PostgreSQL 15 容器成功应用全部 29 个 migration；真实数据库 E2E 通过创建、查询、跟进和关闭生命周期，测试容器已删除。
- 仓库门禁：API 41 套件/390 测试、Web 5 套件/35 测试通过；API/Web build 与五种 Compose 组合通过。
- 远程 2 GB UAT：migration `20260711001000_presales_customer_requirements` 已完成；API/Web 健康；原 9 步业务验收再次 `passed=true`；认证 HTTP 验收单 `REQ-2026-000001` 完成 `DRAFT -> FOLLOWING -> LOST`。
- UAT 镜像标签 `uat-d0ee161` 为本地离线构建/overlay 后传输的临时测试镜像，不是 GHCR 正式发布物。
- 报价 V1 新增 `Quote`、`QuoteVersion`、`QuoteVersionItem` 和 migration `20260711002000_presales_quotes`；空 PostgreSQL 15 已应用全部 30 个 migration，数据库 smoke 创建 `QT-2026-000001 / V1 / CNY / total 200` 成功。
- 报价 V1 本地门禁通过：API 41 套件/394 测试、Web 5 套件/35 测试、五种 Compose 配置和安全审计通过。
- 报价 V1 已部署远程 UAT：migration `20260711002000_presales_quotes` 成功，API/Web 健康；11 步业务验收全部通过，新增链路为 `REQ-2026-000002 -> QT-2026-000001 / V1 / DRAFT / CNY / total 452`。临时离线镜像不是正式 GHCR 发布物。
- 报价工作台提交 `fc32bcc` 已部署为 `uat-fc32bcc`：需求列表显示报价摘要，未报价需求可创建多行 CNY V1。部署后 11 步验收再次通过（`REQ-2026-000003 -> QT-2026-000002`）；GitHub validate、commitlint、CodeQL 全绿。登录后桌面/移动视觉验收仍待完成。
- 版本生命周期提交 `bd7871d` 已部署为 `uat-bd7871d`：远程验收完成 `REQ-2026-000004 -> QT-2026-000003 -> V1 SENT -> V2 DRAFT -> V2 SENT -> V2 ACCEPTED`；数据库确认最终为 `V1 SUPERSEDED / V2 ACCEPTED`。界面状态动作仍待接入。

## 1. 已核对的现有边界

- `Partner` 是客户/供应商统一主数据；新售前对象必须关联同公司 `Partner`，不新建 Customer 表。
- `Order` 当前直接关联 Partner、销售员、税码和明细，创建后发布 `order.created`；订单号仍由随机四位数生成，不能作为新转单接口的幂等依据。
- `WorkflowService` 只允许 `order`、`workOrder`、`invoice` 三类 delegate，且核心能力是状态更新、审计和事件。报价“发出时固化版本”和合同“签署件绑定”等副作用不能只靠通用状态更新完成。
- `FileRecord` 只有公司、上传人和 MinIO 元数据；目录名不能表达合同签署件与版本的业务关系。
- `AuditService.logCrudAction` 是失败后进入 DLQ 的尽力审计；关键转单必须在业务事务内直接写 `AuditLog`。
- `EventQueueService` 以 `EventDlq` 作为可重试队列，`publish()` 会先创建队列记录再同步派发，但当前没有接收 Prisma transaction client 的接口。
- 权限支持 `resource:action` 和通配符；新动作应增加明确权限，不能只依赖 `order:*` 或 `CrudAuto`。

## 2. 本切片范围

包含：

1. 客户需求单的创建、跟进、关闭和转报价。
2. 报价 V1/V2、币种与汇率快照、发出、客户接受/拒绝/过期。
3. 结构化合同台账、合同版本、签署件关联、履约状态。
4. 从指定合同版本分批生成销售订单；每批有稳定幂等键和来源追溯。
5. 一个销售工作台中的需求、报价、合同、订单时间线。

不包含：

- Lead + Opportunity 两层 CRM、营销自动化、邮件群发。
- 报价审批；报价发出是有权限的业务动作，不是审批流。
- 法律文本生成、电子签章、合同 OCR。
- 图纸/BOM 版本和工程变更；它们进入 Phase 3。
- 通用业务对象附件框架、通用状态机重写或现有 OrdersService 大拆分。

## 3. 建议模型

所有业务表必须包含 `companyId`，所有查询、唯一约束和写入校验都必须显式带公司作用域。

| 模型 | 关键字段 | 约束与说明 |
| --- | --- | --- |
| `CustomerRequirement` | `requirementNo`、`partnerId`、`ownerId`、`status`、`sourceChannel`、`summary`、`estimatedAmount`、`expectedCloseDate`、`nextFollowUpAt`、`closeReason` | `@@unique([companyId, requirementNo])`；首期一层需求单 |
| `RequirementActivity` | `requirementId`、`activityType`、`content`、`nextFollowUpAt`、`createdById` | 只追加，不覆盖历史跟进 |
| `Quote` | `quoteNo`、`requirementId`、`partnerId`、`ownerId`、`currentVersionNo` | 主单只承载身份和归属；版本承载商业内容 |
| `QuoteVersion` | `quoteId`、`versionNo`、`status`、`currencyCode`、`baseCurrencyCode`、`exchangeRate`、`exchangeRateAt`、`exchangeRateSource`、`validUntil`、税价/折扣/付款与交付条款、金额合计、`sentAt`、`acceptedAt` | `@@unique([quoteId, versionNo])`；只有 `DRAFT` 可改，发出后不可覆盖 |
| `QuoteVersionItem` | `quoteVersionId`、`productId`、SKU/名称/UOM 快照、数量、单价、折扣、税率、金额 | 保留 `productId` 便于转单，同时固化显示快照；首期转单要求产品仍可用 |
| `SalesContract` | `contractNo`、`partnerId`、`quoteVersionId`、`ownerId`、`status`、`currentVersionNo` | `@@unique([companyId, contractNo])`；允许一个接受的报价版本登记合同 |
| `SalesContractVersion` | `contractId`、`versionNo`、币种/汇率、金额、签署/生效/到期日、付款/交付条款、`status` | `@@unique([contractId, versionNo])`；已签署版本不可覆盖 |
| `ContractAttachment` | `contractVersionId`、`fileRecordId`、`kind`、`uploadedById` | 用真实外键关联签署件；同公司校验；不靠 MinIO 路径表达关系 |

对现有订单只增加可空来源字段，不改写历史订单：

- `Order.sourceRequirementId`
- `Order.sourceQuoteVersionId`
- `Order.sourceContractVersionId`
- `Order.sourceBatchKey`
- `OrderItem.sourceQuoteVersionItemId`

合同允许分批生成多张订单，因此使用
`@@unique([companyId, sourceContractVersionId, sourceBatchKey])` 保证同一批次只生成一次；`sourceBatchKey` 由调用方在首次提交时生成并在重试时复用。

## 4. 状态与不可变规则

### 客户需求单

`DRAFT -> FOLLOWING -> QUALIFIED -> QUOTING -> CONVERTED`

- 非终态可进入 `LOST` 或 `CANCELLED`；`LOST` 必须有原因。
- 每次跟进新增 `RequirementActivity`，不得改写旧活动。

### 报价版本

`DRAFT -> SENT -> ACCEPTED`

- `SENT -> REJECTED / EXPIRED / SUPERSEDED`。
- 发出动作必须一次性验证有效期、税价和汇率快照，并以 `updateMany(where: { id, status: DRAFT })` 防并发重复发出。
- 创建 V2 时复制 V1 为新草稿；V1 内容保持不变，并在 V2 发出后标记 `SUPERSEDED`。
- 不增加 `PENDING_APPROVAL` 或 `APPROVED` 报价状态。

### 合同版本

`DRAFT -> PENDING_APPROVAL -> APPROVED -> PENDING_SIGNATURE -> ACTIVE -> FULFILLED`

- 驳回、取消、终止动作及责任岗位在权限配置中表达。
- 进入 `ACTIVE` 必须有签署日期和至少一个 `SIGNED_COPY` 附件。
- 只有 `ACTIVE` 合同版本可以转订单；已终止、过期或非当前有效版本不得新建订单。

## 5. 汇率边界

- `currencyCode` 和 `baseCurrencyCode` 使用 ISO 4217 三位大写字符串；数据库存交易币与本位币金额。
- `exchangeRate` 建议 `Decimal(18, 8)`；金额继续使用 `Decimal(18, 4)`，禁止 JavaScript 浮点参与最终金额计算。
- 发出报价前在事务外获取实时汇率，在事务内固化汇率、时间和来源；服务不可用时拒绝发出，不静默沿用旧值。
- 本位币报价固定 `exchangeRate = 1`，来源记为 `SYSTEM_BASE`。
- 汇率服务商、超时和最大可接受行情年龄由配置决定，不写死到领域服务。

## 6. 事务、幂等、事件与审计

### 报价发出

1. 读取草稿和明细，完成权限、公司、有效期和金额校验。
2. 在事务外获取汇率；进入事务后再次条件更新 `DRAFT` 状态。
3. 同一事务内写不可变快照字段、`AuditLog` 和一条 `EventDlq(PENDING)`。
4. 提交后尝试派发；派发失败保留 PENDING/RETRYING，由现有重试机制处理。

### 合同版本转订单

1. 请求必须包含稳定 `sourceBatchKey` 和本批行项目/数量。
2. 事务内重新读取并锁定业务前提：同公司、合同版本 `ACTIVE`、报价版本一致、数量合法。
3. 先按复合唯一键查找已有订单；存在时返回相同订单，不重复创建。
4. 创建订单、订单行及全部来源字段；订单金额使用合同/报价快照，不重新读取实时价格或汇率。
5. 同一事务内写 `AuditLog` 和 `EventDlq(PENDING)`；提交后派发 `order.created`。
6. 并发请求以数据库唯一约束为最终防线；捕获唯一冲突后查询并返回既有订单。

为避免领域服务直接复制 EventDlq 写法，先给 `EventQueueService` 增加一个接收 Prisma transaction client 的 `enqueueWithTx()` 小接口；不在本批重写整个事件系统。

### 文件边界

MinIO 上传不能与数据库事务原子提交。流程为“上传 FileRecord -> 事务内校验同公司并创建 ContractAttachment”。关联失败时文件保留为未关联记录，后续由可审计清理任务处理；业务请求不得静默删除用户文件。

## 7. API 与权限

建议以独立 `PresalesModule` 暴露显式命令，不通过通用 Dynamic CRUD 执行状态变更：

| API 动作 | 权限 |
| --- | --- |
| 创建/更新/跟进客户需求 | `requirement:create`、`requirement:update`、`requirement:follow-up` |
| 读取客户需求 | `requirement:read` |
| 创建报价/新版本 | `quote:create`、`quote:update` |
| 发出报价、记录接受/拒绝 | `quote:send`、`quote:record-decision` |
| 创建/更新合同 | `contract:create`、`contract:update` |
| 批准、登记签署、终止合同 | `contract:approve`、`contract:sign`、`contract:terminate` |
| 从合同版本转订单 | `contract:convert-to-order` 与 `order:create` 同时满足 |

Sales 模板默认获得需求、报价和合同草稿权限；合同批准/终止权限不默认授予 Sales。角色名称只用于模板，业务代码只检查动作权限。

## 8. 测试门禁

每个命令先写失败测试，至少覆盖：

- 跨公司 Partner、产品、文件、需求、报价、合同均返回拒绝或不存在。
- 报价发出缺失汇率、过期、金额不平或已发出时拒绝，且不产生半写入。
- 已发出报价不能更新；V2 不覆盖 V1。
- 合同无签署件不能激活，非 ACTIVE 版本不能转订单。
- 同一 `sourceBatchKey` 串行和并发重试只产生一张订单、一组订单行和一个业务结果。
- 转单后的价格、税率、币种、汇率和来源行来自快照，不受产品现价或实时汇率变化影响。
- 事务失败时订单、审计和待派发事件全部回滚；事件派发失败时业务提交保留且队列可重试。
- 权限测试覆盖销售可建草稿、不可批准合同，以及只读角色不能写。
- 一条浏览器 E2E 覆盖需求 -> V1/V2 -> 发出/接受 -> 合同签署 -> 分批转订单 -> 时间线追溯。

## 9. 分批实施顺序

1. **需求 tracer bullet（已完成，`d0ee161`）**：模型、API、最小工作台、公司隔离、跟进时间线、关闭原因和测试。
2. **报价 tracer bullet**：版本与行快照、汇率端口、发出/接受动作、不可变测试和 UI。
3. **合同转单 tracer bullet**：合同版本、签署件、幂等分批转订单、事务审计/事件和 E2E。

每批都应通过相关测试和 `npm run validate` 后单独提交；不得把三个批次压成一次大 migration/Service 重写。

## 10. 实施前剩余门禁

- 确认首个实时汇率服务商，以及行情超时/最大年龄；本位币已确认 CNY。
- 报价和合同沿用已确认的年度编号规则；需求编号 `REQ-YYYY-######` 已实现。
- 确认合同批准、签署、终止的岗位成员和金额阈值。
- 评审新表、可空 Order 来源字段、复合唯一键、索引和前滚/回滚 SQL。
- 先处理或明确接受现有 `Order.orderNo @unique` 的跨公司全局唯一边界；新单号生成不得继续依赖随机四位数。

以上门禁未完成前，不创建报价/合同相关 Prisma migration；客户需求 migration 已独立完成并验证。
