# Next-Gen AI ERP 核心架构、规划与执行状态

> 本文档汇集整合了先前的架构分析 (`analyze.md`)、执行规划 (`plan.md`) 及各阶段交接文档 (`PHASE_X_HANDOVER.md`)，作为本项目的唯一核心蓝图与状态追踪板。

## 一、 系统执行总进度与各阶段状态 (更新于 2026-05-05)

### 🟢 阶段零：内核引擎打造（已验收收口）

* **动态 CRUD API 网关**：引入 `/api/v1/resource/:modelName` 进行全量无代码增删改查。
* **统一元数据中心 (System Dictionary)**：定义全局 `ui-schema.ts`。
* **动态视图引擎**：开发完成前端的核心渲染器 `FormEngine`、`ListEngine`、`KanbanEngine`，支持元数据驱动，取代硬编码编写页面的模式。

### 🟢 阶段一：主数据与基础模块迁移（已验收）

* **Partner 全局统一**：彻底清理了老旧的 `Customer` 代码，实现了 `Partner(CUSTOMER|SUPPLIER)` 的全局接管，`Order` 模型关联替换完成。
* **业务模块清理**：清退硬编码产物，重构为引擎兼容模型，API和 Web 构建全面通过。

### 🟢 阶段二：单据流转、工作流与复式库存内核（已验收）

* **复式库存机制突破**：实施了企业级强度的 `StockQuant`（实时存量）与 `InventoryTransaction`（移库流转单），彻底剥离库存简单加减账逻辑。
* **事件驱动型工作流 (Event-Driven Workflow)**：
  - 落地 `apps/api/src/core/workflow`，提供抽象的 API 改变单据状态：`POST /v1/workflow/:modelName/:id/transition`。
  - 核心突破：剔除了 `OrdersService` 中的硬核单据判断，改用 `@nestjs/event-emitter` 实现跨模块调度。现在销售单发货状态更新会自动抛出 `workflow.action.sale_order.shipped`，并被库存监听器拦截，实现自动复式过账操作。前端看板支持了挂载表单录入移库批次流转。

### 🟢 阶段三 (前置部分)：基础设施升级（已完成）

* **高密度 ERP CSS 主题**：在 `apps/web/src/app/globals.css` 中落地全套企业级变量（紧凑间距、高密度行高、语义状态色、ERP 组件基础样式），对标 Linear/Notion 数据密度。
* **StockLocation 树形结构**：在 `schema.prisma` 中为 `StockLocation` 补全 `parentId` 自引用关联，支持 `仓库→货架区→具体库位` 的多级树形管理。
* **Kysely 实时台账 API**：`GET /api/inventory/realtime-ledger` 已接入 `KyselyService` 原生聚合 SQL，按物料×库位汇总 `totalQty` / `stockValue`，并在服务层计算 `isLow` / `isOut` 低库存标志。
* **库存台账前端仪表盘**：重构 `apps/web/src/app/dashboard/inventory/page.tsx` 为完整的实时库存看板，集成快速过滤（低库存/零库存）、分类筛选、关键字搜索和红绿色预警着色。

### 🟢 阶段三：AI 功能深度集成（核心逻辑已落地，2026-05-05 更新）

* **全局 AI Command Bar (前端)**：✅ 已落地 — CommandPalette.tsx 支持 Cmd+K 快捷键触发自然语言指令。
* **Agent 意图与 Function Calling (后端)**：✅ 已落地 — llm-adapter.service.ts 实现 OpenAI Function Calling 路由，ai.service.ts 注册 5 个 AI Tools。未配置 OPENAI_API_KEY 时自动降级为规则引擎。
* **Smart Dashboard (Chat2SQL)**：✅ 已落地 — chat2dash() 支持图表洞察查询，chat2sql() 支持自然语言转只读 SELECT SQL。

---

## 二、 核心诊断与防“屎山”战略决策

本项目放弃传统的手写页面或路由模式，采用了 **TypeScript 原生的动态视图与业务引擎**，深度采用了“元数据驱动(Metadata-driven)”思想。不更换目前的 `NestJS + Prisma + Next.js App Router` 栈，但采用了截然不同的设计哲学：

1. **No Hardcoded UI（拒绝手写表单页）**：所有基础的增删改查，全部由统一的 `<DynamicView schema={...} />` 和配置 JSON 渲染。
2. **Generic Controller（统一通用接口）**：除非极其特殊的事务流，其余模型全部由系统 `/api/v1/resource/:modelName` 服务托管处理，防止重复造轮子。
3. **Event-Driven（解耦业务联动）**：已通过阶段2验证。绝不允许在 A 模块直接调用 B 模块改库！一切采用 `EventEmitter`（如：侦听到 `stock.moved`，财务系统再去异步生成账单）。

---

## 三、 UI/UX 重构专项规范

全面对标现代前沿 SaaS（Notion, Linear）：

1. **极简排版**：降低 Card 阴影饱和度。通体背景采用极简留白设计。
2. **Chatter 侧边栏设计**：对于任意单据详细页，右侧 30% 应保留为操作记录 / AI批注 / 用户沟通的 Timeline，提升社交与协同样式。
3. **滑出式抽屉替代全屏 Modal**：针对层联数据查看，全部采用半屏幕侧滑（Sheet）组件。
4. **看板驱动 (Kanban-First)**：以拖拽形式管理大部分单据、工单流转。

---

---

## 四、当前主线治理策略（2026-05-05）

项目不建议重写。接下来先做治理收口，再做业务扩展：

1. 冻结 `main` 为发布分支，日常开发迁移到 `develop`。
2. 所有 agent 任务从 `develop` 切 `agent/<scope>/<task>` 分支。
3. 单个 PR 只处理一个业务边界，避免多 agent 同时改 schema、core、lockfile。
4. 合入 `develop` 前必须通过 `npm run validate`。
5. 稳定批次从 `develop` 发 PR 到 `main`，再触发部署。

详见 `docs/architecture/DEVELOPMENT_WORKFLOW.md`、`docs/architecture/STANDARDS.md` 与 `docs/architecture/QUALITY_GATES.md`。
