# 企业级 ERP 核心业务模块开发计划 (前后端分离协作版)

> **文档说明**
> 本规划针对「销售管理 (Sales)」与「库存管理 (Inventory)」两大核心模块，进行了详细的接口、结构和组件级设计。
> **分工模式**：
> 🤖 **前端设计与实现**：由 AI 助理全面负责。接管高网格密度交互、Drawer抽屉式表单、行内编辑及状态缓存。
> 👨‍💻 **后端架构与接口**：由 Node 后端工程师负责。处理 Prisma 领域模型更新、Kysely 报表聚合、业务状态机流转及并发控制。

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

- [ ] `StockLocation` (库位)：必须支持自引用树形结构 `parentId`，以便表示 `华南仓 / 货架区 / A01层`。
- [ ] `StockPicking` (出入库行为单) 及对应的 `StockMove` (移动明细流水)。
- [ ] **核心台账 (`StockQuant`)**：用于记录 `productId + locationId + lotNumber(批次)` 维度下的绝对实物数量与预扣留数量（Reserved Qty）。

#### 2.2 防护机制：防并发超卖与负库存逻辑 (Critical)

- [ ] 发货确认 (`confirm_picking`) 时，严禁使用“先查后改”。**必须**使用我在阶段一优化好的 `$transaction` 事务方案。
- [ ] **乐观锁卡点**：在对 `StockQuant` 做减法更新时，必须加上 Where 并发断言：`where: { id: quantId, quantity: { gte: 扣减数量 } }`，如果驱动返回 `.count === 0`，代表被他人抢占或库存不足，立即触发 `Rollback`，抛出 `ConflictException` ('可用库存不足')。

#### 2.3 高性能报表引擎 (Kysely)

- [ ] 针对出入库流水，避免使用深层 Prisma 嵌套分页。通过我们此前已经封装的 `KyselyService` 专属连接池，编写原生的 Postgres 聚合 SQL：
  `SELECT productId, locationId, SUM(quantity) as net_qty FROM stock_moves WHERE ... GROUP BY productId, locationId`
- [ ] 将其打包暴露为 `GET /api/v1/inventory/realtime-ledger` 接口用于高频数据大屏读取。

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

这份规划已经保存在 `docs/plans/CORE_MODULES_DEV_PLAN.md` 供查阅。
你可以将上述要求截取给后端开发工程师。

**对于接下来我的工作：**
我不用等他把 Prisma 和 NestJS 的代码跑通。**你现在就可以让我开始**！
我们只需要约定先做 **【销售模块表单设计】** 还是 **【库存台账分析组件】**。我会自己在 `apps/web/` 下建立对应的 React 文件，使用 Mock 数据跑起包含酷炫交互、`TanStack Table` 行内编辑以及多 Tab Drawer 的界面！

一旦界面搭建完备，后端写好接口后，直接替换网络调用的胶水层，即刻就能上线。
