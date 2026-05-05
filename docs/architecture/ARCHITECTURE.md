# OneERP 架构全景（Architecture Overview）

> **最后更新**: 2026-05-05  
> **维护者**: Core Team / 架构师  
> **关联文档**: [STANDARDS.md](./STANDARDS.md) · [QUALITY_GATES.md](./QUALITY_GATES.md) · [DEVELOPMENT_WORKFLOW.md](./DEVELOPMENT_WORKFLOW.md) · [PROJECT_PLAN_AND_STATUS.md](../plans/PROJECT_PLAN_AND_STATUS.md)

---

## 1. 项目定位

OneERP 是一套面向制造与供应链场景的 **AI Native ERP**，主打：

- **元数据驱动 UI** — 新增业务模型零页面开发
- **通用 CRUD 引擎** — `/api/v1/resource/:modelName` 统一网关
- **事件驱动联动** — 库存、财务、生产通过 EventEmitter 解耦
- **AI 命令栏** — 自然语言触发业务动作（Function Calling + 规则引擎兜底）

---

## 2. 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 后端框架 | NestJS | 11.x |
| ORM | Prisma | 6.x |
| 辅助查询 | Kysely | 0.28.x |
| 数据库 | PostgreSQL | 15 |
| 缓存 | Redis | 7.x |
| 对象存储 | MinIO | latest |
| 前端框架 | Next.js (App Router) | 16.x |
| UI 组件 | shadcn/ui + Radix | latest |
| 状态管理 | Zustand | 5.x |
| 桌面端 | Tauri | 2.x |
| 移动端 | Expo (React Native) | 53.x |
| AI 适配 | OpenAI API (Function Calling) | gpt-4o-mini |
| 构建工具 | Turborepo + npm workspaces | - |

---

## 3. Monorepo 目录结构

```
OneERP/
├── apps/
│   ├── api/          # NestJS 后端服务
│   │   ├── prisma/   # Schema + Migrations
│   │   └── src/
│   │       ├── core/ # 核心引擎（CRUD / Metadata / Workflow / Audit / AI）
│   │       ├── orders/
│   │       ├── inventory/
│   │       ├── finance/
│   │       ├── production/
│   │       └── ...
│   ├── web/          # Next.js 前端
│   │   └── src/
│   │       ├── app/          # App Router 页面
│   │       ├── components/   # UI 组件 + 动态引擎 + AI 组件
│   │       ├── store/        # Zustand 状态管理
│   │       └── lib/          # 工具函数
│   ├── mobile/       # Expo 移动端（规划中）
│   └── desktop/      # Tauri 桌面端（规划中）
├── docs/
│   ├── architecture/ # 架构文档（本文档 + STANDARDS.md）
│   ├── plans/        # 规划与状态文档
│   ├── analysis/     # 缺失功能分析
│   └── AI_INSTRUCTIONS.md  # AI Agent 协作规范
└── .github/
    └── workflows/
        ├── ci.yml       # CI 流水线（commitlint + validate）
        └── deploy.yml   # CD 流水线（GHCR 镜像构建）
```

---

## 4. 核心引擎架构

### 4.1 通用 CRUD 引擎 (`core/crud/`)

```
/api/v1/resource/:modelName
  ├── GET    /           → 分页查询（支持动态 filter/sort/include）
  ├── GET    /:id        → 单条记录
  ├── POST   /           → 创建
  ├── PATCH  /:id        → 更新
  └── DELETE /:id        → 删除
```

- **零代码扩展**：新增 Prisma 模型后自动获得完整 CRUD API
- **多租户注入**：`TenantContextMiddleware` 自动注入 `companyId`
- **关联查询**：`?include=items,partner` 动态展开

### 4.2 元数据中心 (`core/metadata/`)

- `ui-schema.ts` 定义全局字段字典（label / type / required / hidden）
- 前端 `DynamicView` 引擎根据 schema 自动渲染表单和列表
- 支持 `customAttributes` (JSONB) 扩展字段

### 4.3 工作流引擎 (`core/workflow/`)

```
POST /api/v1/workflow/:modelName/:id/transition
  body: { action: "submit" | "confirm" | "ship" | "complete" | "cancel" }
```

- 状态跃迁表写在代码中（非数据库配置）
- 事件触发：`workflow.action.sale_order.shipped` → 库存监听器自动扣减
- 审计日志：每次状态变更记录到 `AuditLog`

### 4.4 AI 命令服务 (`core/ai/`)

```
POST /api/v1/ai/command
  body: { input: "帮我创建一个销售订单", dryRun: true }
```

**架构分层**：
```
用户输入 → AIService.command()
             ├── LLM 路由（OpenAI Function Calling）
             │     └── LlmAdapterService.resolveToolCall()
             │           ├── create_resource
             │           ├── transition_workflow
             │           ├── chat2dash_query
             │           ├── chat2sql_read
             │           └── parse_document_draft
             └── 规则引擎兜底（关键词匹配 + 正则提取）
```

- **dry-run 模式**：写操作先生成 Draft 卡片，用户确认后执行
- **降级策略**：未配置 `OPENAI_API_KEY` 时自动降级为规则引擎

---

## 5. 数据库架构

### 5.1 核心业务模型

```
Company (多租户根)
  ├── Partner (客户/供应商)
  ├── Product / Material (产品/物料)
  ├── Order → OrderItem (销售订单)
  ├── Invoice → Payment (发票/收款)
  ├── TaxCode (税码主数据) ← 2026-05-05 新增
  ├── StockLocation (库位，树形)
  ├── StockQuant (实时存量)
  ├── InventoryTransaction (库存流水)
  ├── Account (会计科目，树形)
  ├── JournalEntry → JournalEntryLine (会计凭证)
  └── WorkOrder (生产工单)
```

### 5.2 多租户隔离

- 所有业务表包含 `companyId` 外键
- `TenantContextMiddleware` 自动注入租户上下文
- Prisma 查询自动附加 `WHERE companyId = ?`
- **待增强**：PostgreSQL RLS 物理隔离（计划中）

### 5.3 税码引擎（2026-05-05 新增）

```prisma
model TaxCode {
  id             String   @id @default(uuid())
  code           String
  name           String
  rate           Float    @default(0)
  isTaxInclusive Boolean  @default(true)
  isDefault      Boolean  @default(false)
  active         Boolean  @default(true)
  accountId      String?
  companyId      String
  @@unique([companyId, code])
}
```

- `finance.service.resolveTaxCode()` 动态查找税码
- 未指定时回退默认税码或 13% 兜底
- Order / OrderItem / Invoice 均关联 `taxCodeId`

---

## 6. CI/CD 架构

### 6.1 CI 流水线 (`.github/workflows/ci.yml`)

```yaml
触发条件:
  - pull_request → main, develop
  - push → develop

Jobs:
  1. commitlint — 校验提交消息格式
  2. validate — prisma validate → generate → typecheck → lint → test → build
```

### 6.2 CD 流水线 (`.github/workflows/deploy.yml`)

```yaml
触发条件:
  - push → main
  - workflow_dispatch (手动)

Jobs:
  1. build-api — 构建 API Docker 镜像 → 推送 GHCR
  2. build-web — 构建 Web Docker 镜像 → 推送 GHCR
  3. deploy — 部署占位（需配置 SSH 或 Docker Compose）
```

---

## 7. AI 集成架构

### 7.1 后端 AI 模块 (`apps/api/src/core/ai/`)

| 文件 | 职责 |
|------|------|
| `ai.module.ts` | NestJS 模块注册 |
| `ai.controller.ts` | REST API 端点 |
| `ai.service.ts` | 业务逻辑（指令路由 + 工具执行） |
| `llm-adapter.service.ts` | LLM 调用适配（OpenAI API） |
| `dto/ai-command.dto.ts` | 请求/响应 DTO |

### 7.2 前端 AI 组件 (`apps/web/src/components/ai/`)

| 文件 | 职责 |
|------|------|
| `CommandPalette.tsx` | Cmd+K 命令面板 |
| `Chat2DashPanel.tsx` | 图表洞察面板 |

### 7.3 AI Tools 注册表

| Tool Name | 描述 | 读/写 |
|-----------|------|-------|
| `create_resource` | 创建任意模型记录 | 写 |
| `transition_workflow` | 执行工作流状态跃迁 | 写 |
| `chat2dash_query` | 图表洞察查询 | 读 |
| `chat2sql_read` | 自然语言转只读 SQL | 读 |
| `parse_document_draft` | 附件解析生成草稿 | 读 |

---

## 8. 事件驱动架构

```
EventEmitter (NestJS)
  ├── workflow.action.* → 审计日志
  ├── order.shipped → 库存扣减 + 财务凭证
  ├── stock.depleted → 财务成本结转
  └── invoice.posted → 应收账款更新
```

- 使用 `@nestjs/event-emitter` + `eventemitter2`
- 失败事件进入 DLQ (`EventDlq`) 待重试

---

## 9. 部署架构

### 9.1 本地开发

```bash
docker compose up -d          # Postgres + Redis + MinIO
cd apps/api && npm run start:dev
cd apps/web && npm run dev
```

### 9.2 生产部署

```
GitHub Actions
  → Build Docker Images
  → Push to GHCR (ghcr.io/<owner>/oneerp-api, ghcr.io/<owner>/oneerp-web)
  → Deploy via SSH / Docker Compose (待配置)
```

---

## 10. 当前架构状态总结

| 维度 | 状态 | 备注 |
|------|------|------|
| 核心引擎 | ✅ 90% | CRUD / Metadata / Workflow / Audit |
| 业务模块 | ⚠️ 60% | 销售/库存/财务已有，采购缺失 |
| AI 集成 | ✅ 65% | Function Calling + Chat2SQL 已落地 |
| CI/CD | ✅ 80% | CI 流水线完整，CD 部署待配置 |
| 税务引擎 | ✅ 60% | TaxCode 模型 + 动态解析已落地 |
| 安全加固 | ⚠️ 40% | 应用层租户隔离，RLS 待增强 |
| 可观测性 | ⚠️ 20% | 基础日志，无 APM/告警 |

---

## 11. Agent 接手原则

本仓库不要求 agent 每次从零理解。接手任务时先读固定入口：

1. `README.md`
2. `docs/architecture/ARCHITECTURE.md`
3. `docs/architecture/STANDARDS.md`
4. `docs/architecture/QUALITY_GATES.md`
5. `docs/architecture/DEVELOPMENT_WORKFLOW.md`
6. 任务涉及的模块文件与测试

更多分支、CI、多 agent 协作和新手维护流程见 [DEVELOPMENT_WORKFLOW.md](./DEVELOPMENT_WORKFLOW.md)。

---

**文档维护说明**: 本文档应随代码架构变更同步更新。重大架构决策请在 `docs/plans/` 中记录。
