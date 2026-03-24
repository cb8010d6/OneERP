# Next-Gen AI ERP 核心架构、规划与执行状态

> 本文档汇集整合了先前的架构分析 (`analyze.md`)、执行规划 (`plan.md`) 及各阶段交接文档 (`PHASE_X_HANDOVER.md`)，作为本项目的唯一核心蓝图与状态追踪板。

## 一、 系统执行总进度与各阶段状态 (更新于 2026-03-23)

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

### 🚧 阶段三：AI 功能深度集成（接下来即将进入）

* **全局 AI Command Bar (前端)**：描述：在前端顶部栏实现类似 Command Palette 的输入框，并接入自然语言理解。用户可输入“帮我创建一个销售订单，卖给微软10台服务器”。直接文字/语音下达自然语言指令。
* **Agent 意图与 Function Calling (后端)**：接入 LLM 的 Tool Call，借助阶段零生成的通用 CRUD 自动执行业务流配置。**NL2Action 控制器（后端）** *  **描述** ：开发意图识别和 Function Calling 服务。当收到文字时，提取实体映射到 [api](vscode-file://vscode-app/c:/Users/INDEX/AppData/Local/Programs/Microsoft%20VS%20Code/07ff9d6178/resources/app/out/vs/code/electron-browser/workbench/workbench.html) 的相关 Controller（此时调用大模型的 tool/function-calling 机制解析 JSON 参数并调用对应的业务流）。
* **Smart Dashboard (Chat2SQL)**：实时根据语义绘制分析图表。**RAG 数据分析（Text-to-SQL）** *  **描述** ：将数据库 Schema 喂给大模型（或微调专属模型），支持用户直接在 Dashboard 提问（例如：“上个月哪个部门采购的物料最多？”），系统自动生成报表或数据透视表。

### ⚪ 阶段四：测试、优化与部署（计划中）

* 端到端流转测试，编写集成测试，尤其是“采购->收货入库->产生应付账款”整个资金链路的断言测试。
* 容器化服务剥离，优化 [docker-compose.yml](vscode-file://vscode-app/c:/Users/INDEX/AppData/Local/Programs/Microsoft%20VS%20Code/07ff9d6178/resources/app/out/vs/code/electron-browser/workbench/workbench.html)，拆分服务为 API, Web, Postgres, Redis 等，并确保自动化部署脚本完备。，基于 `docker-compose` 和 CI/CD 进行多端部署打包。

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

> _详见根目录 `ENGINEERING_STANDARDS.md` 获取完整的防腐化编码守则与验证规则。这套基建保证了本项目能在极小代码量下拓展成百上千张业务模型，具备工业级可维护性。_
