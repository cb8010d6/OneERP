# 企业级 ERP 核心业务模块开发计划 (前后端分离协作版)

> **文档说明**
> 本规划面向 OneERP 后续业务模块建设。销售、库存已有较多基础，下一阶段重点是采购、财务、生产、权限和可靠性闭环。
> **分工模式**：
> 🤖 **前端设计与实现**：由 AI 助理全面负责。接管高网格密度交互、Drawer抽屉式表单、行内编辑及状态缓存。
> 👨‍💻 **后端架构与接口**：由 Node 后端工程师负责。处理 Prisma 领域模型更新、Kysely 报表聚合、业务状态机流转及并发控制。

---

## 0. 开发总策略

### 0.1 主线策略

- `main`：生产发布分支，只接收从 `develop` 发起的 PR。
- `develop`：集成分支，所有功能先合入这里并跑完整 CI。
- `agent/<scope>/<task>`：单任务分支，禁止一个 agent 分支同时改多个业务域。

### 0.2 模块交付顺序

| 阶段 | 模块 | 目标 | 验收方式 |
| --- | --- | --- | --- |
| P0-A | 采购全链路 | 采购订单、收货、三方匹配、应付草稿 | API 单测 + purchase E2E |
| P0-B | 财务可靠性 | 凭证冲销、反审核、试算平衡、DLQ 定时重试 | Accounting 单测 + finance E2E |
| P1-A | 生产联动 | 工单完成事件、成品入库、订单状态联动 | Production 单测 + 事件测试 |
| P1-B | RBAC 权限 | PermissionGuard、菜单/按钮权限 | Auth/API 单测 + Web smoke |
| P1-C | 库存单据 | StockPicking/StockMove、批次、预留库存 | Inventory 集成测试 |
| P2 | 可观测性与部署 | 健康检查、日志、备份、部署回滚 | CI + 手动部署演练 |

### 0.3 Agent 拆工原则

- DB Agent 先完成 schema/migration，API Agent 再接 service/controller，Web Agent 最后接页面。
- 同一时间只有一个 agent 修改 `schema.prisma`。
- 核心引擎 `core/crud`、`core/workflow`、`components/core` 仅在明确需要升级引擎时修改。
- 每个模块必须补“业务规则测试”，不只补页面。

---

## 阶段一：销售管理模块 (Sales Management)

### 1. 业务目标

实现从“客户询价 -> 销售订单 (SO) 创建 -> 审批流转 -> 扣减可用库存 -> 自动生成出库单”的链路闭环。

### 2. 👨‍💻 后端工程师任务 (Backend Tasks)

要求后端优先定义模型并提供 Swagger / DTO 契约（或在 NestJS Controller 写好签名），并跑通 CRUD，供前端联调。

#### 2.1 数据库防腐设计 (Prisma Schema)

- [ ] 创建 `SaleOrder` (销售主表) 和 `SaleOrderLine` (订单明细表)。
- [ ] **关联模型**：必须关联 `Customer` (客户表)、`Company` (多租户标识) 以及 `Product` (商品库)。
- [ ] **金额精度规范**：所有计费字段（如 `unitPrice`, `discount`, `totalAmount`）必须严格使用数据库级别的 `Decimal` 类型，严禁使用 Float，必须在存入前进行基于大数运算库 (.e.g `decimal.js`) 的重算与校验。

#### 2.2 状态机能力接入 (Workflow Engine)

- [ ] 使用现有的 `WorkflowService` 为 `sale_order` 注册状态跃迁。主要路径：`DRAFT (草稿) -> SUBMITTED (已提交) -> CONFIRMED (已确认) -> SHIPPED (已发货) -> COMPLETED (已完成) / CANCELLED (已取消)`。
- [ ] **物理拦截器 (Guards)**：在 Prisma 钩子或 Service 层面做拦截器，只有单据处于 `DRAFT` 或 `SUBMITTED` 状态时才允许修改明细行和金额，达到 `CONFIRMED` 后全局锁定，只读不可写。

#### 2.3 接口契约规范 (REST API)

- [ ] `GET /api/v1/sales-orders`：支持动态字段过滤、排序、分页。
- [ ] `GET /api/v1/sales-orders/:id`：单据加载接口，必须携带 `include: { lines: { include: { product: true } } }` 以获得渲染全貌。
- [ ] `POST /api/v1/sales-orders` 级联保存接口，请求体 (Body) 需支持级联数组传入明细行：`{ ..., lines: [{ productId, quantity, unitPrice }] }`。

---

### 3. 🤖 前端任务 (Frontend Tasks - )

只要业务契约对齐，前端即可启动“视觉先行”的纯组件与状态开发。

#### 3.1 销售看板与增强型 ListEngine

- **定制化 Columns 渲染**：利用刚才引入的 TanStack Table，针对“总金额”做千分位财务格式化展示，针对“状态”字段挂载绿、黄、灰三色角标 (Badge)。
- **快捷 Quick Filters**：注入状态选项卡，使用户可一键在“我的订单”、“待审批”、“已完成”间快速切换切片，替代每次输入关键字搜索。

#### 3.2 复杂的抽屉分面表单 (Faceted Drawer Form)

全面停用以前的纯流式滚动大表单。通过 `Sheet` 抽屉承载订单编辑上下文：

- **吸顶动作区 (Sticky Action Bar)**：悬浮在抽屉最顶部。左侧显示大号订单编号，右侧渲染当前状态机支持允许流转的动作（例如动态渲染蓝色“确认订单”按钮）。
- **多标签页内聚 (Tabs Group)**：
  - **👉 面板 1：明细行 (Order Lines Grid)**
    - **重型特性：Excel 级极速行内编辑 (Inline DataGrid)**。抛弃传统的弹出 Modal 修改明细。直接在子表格内部 `onDoubleClick` 激活单元格 `<input>`，允许业务员通过键盘 `Tab` 和 `Enter` 键连贯录入物料编码、数量与单价。
    - **状态联动计算**：利用 Zustand 或 React `useMemo` 实现在前端修改行明细时，地步实时汇总 `Subtotal`, `Tax`, `TotalAmount`。
  - **👉 面板 2：交易与物流 (Trading & Logistics)**
    - 收款条款 (Payment Terms)、送货地址 (Shipping Address) 级联选择器。
  - **👉 面板 3：系统追踪 (Chatter Timeline)**
    - 复用基础库已有的事件记录组件，显示用户审批记录和机器人的自动化执行日志。

---

## 阶段二：库存与台账模块 (Inventory & Stock Ledger)

### 1. 业务目标

解决 ERP 最头痛的“账实不符”及“高并发发货导致负库存异常”问题。

### 2. 👨‍💻 后端工程师任务 (Backend Tasks)

#### 2.1 数据库结构 (Prisma Schema)

- [x] `StockLocation` (库位)：支持自引用树形结构 `parentId`，以便表示 `华南仓 / 货架区 / A01层`。
- [ ] `StockPicking` (出入库行为单) 及对应的 `StockMove` (移动明细流水)。
- [ ] **核心台账 (`StockQuant`)**：用于记录 `productId + locationId + lotNumber(批次)` 维度下的绝对实物数量与预扣留数量（Reserved Qty）。

#### 2.2 防护机制：防并发超卖与负库存逻辑 (Critical)

- [ ] 发货确认 (`confirm_picking`) 时，严禁使用“先查后改”。**必须**使用我在阶段一优化好的 `$transaction` 事务方案。
- [ ] **乐观锁卡点**：在对 `StockQuant` 做减法更新时，必须加上 Where 并发断言：`where: { id: quantId, quantity: { gte: 扣减数量 } }`，如果驱动返回 `.count === 0`，代表被他人抢占或库存不足，立即触发 `Rollback`，抛出 `ConflictException` ('可用库存不足')。

#### 2.3 高性能报表引擎 (Kysely)

- [x] 针对出入库流水，避免使用深层 Prisma 嵌套分页。通过我们此前已经封装的 `KyselyService` 专属连接池，编写原生的 Postgres 聚合 SQL：
  `SELECT productId, locationId, SUM(quantity) as net_qty FROM stock_moves WHERE ... GROUP BY productId, locationId`
- [x] 将其打包暴露为 `GET /api/inventory/realtime-ledger` 接口用于高频数据大屏读取。

---

### 3. 🤖 前端任务 (Frontend Tasks ）

#### 3.1 扫码枪兼容与极速录入模式

- 在 `StockPicking` 出入库执行页的抽屉中，我会实现一个专门的**隐藏式焦点监听区 (Barcode Listener)**。
- 监听外接扫码枪模拟触发的 `Enter` 键事件。每次扫入条码，前端拦截事件并在对应的行明细组件中将 `Quantity` 自动 +1。

#### 3.2 Kysely 实时台账网格 (Stock Ledger Grid)

- 接管 Kysely 暴露出来的高密度统计 JSON，引入树形网格扩展 (DataGrid Tree Data)。
- 用户可以点击“折叠/展开”箭头，从“仓库级总数”逐级钻取向下看，直到具体的“某物料、在某库位、某特定批次的剩余库存数据”。
- 配合红绿色警告背景：当可用数低于安全库存阈值时，该单元格强制定染全红并闪烁警告。

---

## 🚀 交付落地流 (Action Items for User)

这份规划保存在 `docs/plans/CORE_MODULES_DEV_PLAN.md`。后续 agent 必须按“DB → API → Web → Test → Docs”的顺序拆卡执行，不建议直接视觉先行大规模写 Mock 页面。

---

## 阶段三：采购全链路 (Purchase)

### 1. 业务目标

实现“供应商 → 采购订单 → 审批 → 收货 → 三方匹配 → 应付账款”的闭环。

### 2. 后端任务

- [x] 基础 `purchase-orders` 目录已存在。
- [x] `goods-receipts` 模块已开始建设。
- [ ] 梳理 `PurchaseOrder` / `PurchaseOrderLine` / `GoodsReceipt` / `GoodsReceiptLine` 与当前 Prisma schema 是否一致。
- [ ] 补齐采购状态机：`DRAFT -> SUBMITTED -> APPROVED -> PARTIALLY_RECEIVED -> RECEIVED -> CLOSED / CANCELLED`。
- [ ] 收货时必须写库存流水，不允许直接改库存数量。
- [ ] 三方匹配必须校验采购单、收货单、供应商账单的数量、单价、税码和币种。
- [ ] 生成应付草稿时必须进入财务模块，不允许采购模块直接写会计余额。

### 3. 前端任务

- [ ] 采购订单列表：状态筛选、供应商筛选、预计到货日期筛选。
- [ ] 采购订单抽屉：主信息、明细行、收货记录、应付记录、审计时间线。
- [ ] 收货页面：支持按采购单收货、部分收货、超收拦截。
- [ ] 三方匹配页面：展示差异原因和处理动作。

### 4. 验收

- [ ] `npm --prefix apps/api run test -- purchase`
- [ ] `npm --prefix apps/api run test -- goods-receipts`
- [ ] `npx playwright test e2e/purchase-flow.spec.ts`
- [ ] 根目录 `npm run validate`

---

## 阶段四：财务可靠性 (Finance)

### 1. 业务目标

将当前自动记账能力提升到可审计、可冲销、可追踪的财务底座。

### 2. 后端任务

- [ ] `JournalEntry` 增加或确认状态流：`DRAFT -> POSTED -> REVERSED / CANCELLED`。
- [ ] 新增凭证冲销 API，生成反向借贷分录，不删除历史凭证。
- [ ] 新增试算平衡表 API，按期间、科目、公司聚合。
- [ ] `FinanceDlqService.retryPending()` 接入定时任务。
- [ ] 明确税码、科目、供应商账单、发票之间的过账规则。
- [ ] 所有金额字段使用 Decimal 语义，避免 Float 误差扩散。

### 3. 前端任务

- [ ] 财务凭证列表与详情。
- [ ] 凭证冲销确认弹窗。
- [ ] 试算平衡表。
- [ ] 财务 DLQ 重试面板。

### 4. 验收

- [ ] `npm --prefix apps/api run test -- finance`
- [ ] `npm --prefix apps/api run test -- accounting`
- [ ] `npx playwright test e2e/finance.spec.ts`

---

## 阶段五：生产联动 (Production)

### 1. 业务目标

实现“销售订单 → 生产工单 → 报工 → 成品入库 → 订单推进”的闭环。

### 2. 后端任务

- [ ] 工单报工达到计划数量时发射 `production.work_order.completed`。
- [ ] 监听生产完成事件，生成成品入库事件或库存移动。
- [ ] 订单监听生产完成后推进状态。
- [ ] 对工单超报、重复报工、取消报工做幂等校验。

### 3. 前端任务

- [ ] 生产工单看板。
- [ ] 报工抽屉。
- [ ] 工单时间线。
- [ ] 成品入库状态展示。

### 4. 验收

- [ ] `npm --prefix apps/api run test -- production`
- [ ] 事件队列幂等测试
- [ ] 生产 E2E 补充或扩展

---

## 阶段六：权限、安全与多租户硬化

### 1. 业务目标

让系统从“能跑”进入“可多人使用、可隔离、可审计”的状态。

### 2. 后端任务

- [ ] 实现 `PermissionsGuard`。
- [ ] 新增 `@RequirePermissions()` 装饰器。
- [ ] API 按模块声明权限点，例如 `purchase:read`、`purchase:write`、`finance:post`。
- [ ] 审查所有查询是否注入 `companyId`。
- [ ] 规划 PostgreSQL RLS，不急于一次性落地。

### 3. 前端任务

- [ ] 菜单按权限展示。
- [ ] 按钮按权限禁用或隐藏。
- [ ] 无权限页面和 API 403 处理。

### 4. 验收

- [ ] Auth/RBAC 单元测试。
- [ ] 租户隔离 E2E。
- [ ] 权限 UI smoke test。

---

## 阶段七：AI Agent 工具与知识库

### 1. 业务目标

让 OneERP 内置 AI 和开发 agent 都能先查工具/文档，再推理，降低 token 成本。

### 2. 系统内 AI Tools

- [x] `create_resource`
- [x] `transition_workflow`
- [x] `chat2dash_query`
- [x] `chat2sql_read`
- [x] `parse_document_draft`
- [ ] `read_module_guide`
- [ ] `explain_error`
- [ ] `draft_workflow_action`
- [ ] `validate_business_rule`

### 3. 开发 Agent Skill

- [ ] 把 `docs/architecture/DEVELOPMENT_WORKFLOW.md` 做成通用 agent 常驻规则。
- [ ] 为采购、库存、财务、生产分别建立任务模板。
- [ ] 建立 CI 失败排查模板：依赖、Prisma、类型、Lint、测试、Docker 六类。

### 4. 验收

- [ ] 新 agent 能在 10 分钟内根据文档定位任务边界。
- [ ] 每个任务卡片不需要粘贴全仓库上下文。
- [ ] PR 描述能自动包含验证命令和影响范围。
