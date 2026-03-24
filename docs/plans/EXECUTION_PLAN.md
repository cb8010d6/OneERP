# 企业级 AI ERP 工程执行计划 (Execution Plan)

> **目标**：在保持现代化全栈架构 (NestJS + Next.js App Router) 的基础上，彻底解决前端“简陋、不好用”的问题，并完成底层内核的安全与性能改造。最终交付高体验的现代企业级管理系统。

---

## 阶段一：前端体验与架构全面升级 (UX/UI Overhaul)

当前前端界面虽然使用了 shadcn/ui，但仅仅是基础组件堆砌，缺乏企业级数据密度和连贯的交互心智。需进行以下重构，使其做到“高信息密度”、“极易上手”且“功能强大”：

### 1.1 页面布局与导航结构 (App Shell)
* **抛弃单页面流式滚动**：引入“固定头部 + 左右自适应双侧边栏 + 大工作区”的经典 ERP 布局风格 (类似于 Linear 或 Datadog 的紧凑设计)。
* **多标签页 (Multi-Tab) 系统**：在工作区顶部实现“文档 Tab”机制。ERP 用户经常需要对比采购单和入库单，必须支持同时开启多个业务单据且切换时不丢失表单状态 (依赖 Zustand 缓存化)。
* **Master-Detail (主从视图)**：列表页点击不跳转全屏页面，而是右侧滑出宽屏抽屉 (Drawer) 或者采用左表右单的拆分面板 (Split-Pane)，最大化操作效率。

### 1.2 高性能数据网格 (Advanced Data Grid)
* 目前普通的 HTML/Tailwind Table 完全无法满足 ERP 需求（冻结列、多级表头、高级聚合、行内编辑）。
* **行动项**：引入并封装 **AG Grid** (社区版/企业版) 或 **TanStack Table v8**。
* **必备功能**： 
  1. 用户自定义列显示 / 隐藏 / 拖拽排序（将偏好保存到数据库的 `UserSetting`）。
  2. 极速行内编辑 (Inline Cell Editing)，像 Excel 一样直接在明细行录入物料、数量和价格。
  3. 虚拟滚动 (Virtual Scrolling) 支持万行数据秒级渲染。

### 1.3 现代化的表单与动态引擎 (Form Engine)
* **高密度布局**：调整 Tailwind 间距 (Spacing) 和 shadcn 的基础 Size（如缩减 padding，调整字号为 13px/14px），适应企业系统的高数据密度要求。
* **分面表单 (Faceted Forms)**：超大表单必须引入 Sticky Action Bar (吸顶保存按钮)；页面内使用纵向或横向 Tabs 将字段分组（基本信息、财务、物流追踪）。
* **关系型浮层录入**：例如在录入订单时，如果客户不存在，可以在下拉框内部直接弹出快速创建对话框（Quick Create），不打断当前单据录入流。

### 1.4 Command Palette 与键盘效率 (Keyboard First)
* 强化现有的 `Cmd+K` 菜单。
* 添加快捷键绑定：`Ctrl+S` 保存，`/` 定位搜索，`Alt+N` 新建单据。保证熟练业务员可以脱离鼠标全键盘操作。

---

## 阶段二：后端内核加固与重构 (Backend Core Evolution)

为支撑上面提到的更高级前端特性和更严密的业务逻辑，Node 工程师需要完成以下底层改造：

### 2.1 全局租户强隔离 (RLS & Middleware)
* 彻底抛弃业务层手动拼写 `where: { companyId }`。
* **步骤**：
  1. 在 PostgreSQL 端启用 RLS（Row Level Security）。
  2. 通过 Prisma Middleware 拦截查询，并在请求上下文中注入 `SELECT set_config('app.current_tenant', $1, true)`。
  3. 任何未携带确切上下文的 DB 访问必须直接报错，从物理层斩断越权隐患。

### 2.2 状态机引入与业务流转 (State Engine)
* **问题**：单据依靠 `status: 'DRAFT' | 'APPROVED'` 这种简单的字符串枚举在大型 ERP 中注定走向死胡同。
* **行动项**：引入 **XState** 或在 NestJS 内部手写一张基于有向无环图 (DAG) 的状态跃迁表库 (`transitions: { from: 'DRAFT', to: 'SUBMITTED', guards: [isManager] }`)。
* 只有合法状态流转才能触发事件（触发器驱动）。

### 2.3 ORM 补充与复杂报表查询
* 在 `apps/api/src/core/prisma` 中集成 **Kysely** 配合 Prisma。
* 针对进销存台账、多维度财务利润表这类需要大量 `LEFT JOIN`、`GROUP BY` 以及对 `JSONB` 字段深层过滤的场景，避免使用 Prisma 的深层嵌套生成低效 SQL，直接使用 Kysely 编写强类型的原生聚合 SQL。

---

## 阶段三：具体执行流 (Workflow for the Engineer)

**给接手工程师的直接任务清单：**

1. **阅读基础库并搭起环境**
   * 阅读 `docs/ENGINEERING_STANDARDS.md` 熟悉开发规范。
   * 运行 `docker-compose up -d` 启动数据库，执行 `npm run dev` 启动全栈。

2. **第一周：基础设施与底层（Node/NestJS 工程师）**
   * [ ] 完成 Prisma RLS 改造方案验证并合入基础 `CrudService`（已完成租户上下文 + Prisma Middleware 注入 `set_config('app.current_tenant')`，待补 PostgreSQL RLS 策略与 CrudService 最终收口）。
   * [x] 选型并搭建状态机引擎 (State Machine) 用于订单流转。
   * [x] 将 `Kysely` 实例混入 Nest 依赖注入。

3. **第二周：前端体验焕新（React/Next.js 工程师）**
   * [ ] 覆盖 shadcn 的 CSS 变量，收敛组件的 Padding/Margin 打造高密度 ERP 主题。
   * [x] 搭建双侧边栏+多标签页 (Multi-tab Wrapper) 布局框架。
   * [x] 实现 TanStack Table 或 AG Grid 的深度封装组件，需带有行内编辑 (Cell Editable) 的基类演示（以 `apps/web/src/components/ui/data-grid` 建立）。

4. **第三周：向核心业务模块发起冲击**
   * 采用前两周固化好的新版组件库和底层引擎，集中兵力重塑【销售管理】和【库存出入库单】，建立新范式的最佳实践样板供后续所有模块抄作业。

> **版本控制提示**
> 整个项目已使用 Git 初始化。请创建如 `feat/frontend-redesign` 和 `feat/backend-rls` 等功能分支进行作业。系统源码留存于同级目录，仅作模型与业务逻辑设计的参考。
