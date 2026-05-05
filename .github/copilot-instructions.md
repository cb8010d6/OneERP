# Copilot Agent Collaboration Instructions

## 目标

在本仓库中进行协作开发时，所有 Agent 必须遵循以下约束，避免破坏 ERP 核心引擎一致性。

## 分支策略

- 生产分支: `main`
- 集成分支: `develop`
- 后端任务分支: `agent/backend/<topic>`
- 前端任务分支: `agent/frontend/<topic>`
- 数据库任务分支: `agent/db/<topic>`

禁止直接向 `main` 推送。

## 必读文档

- `docs/architecture/ARCHITECTURE.md`
- `docs/architecture/STANDARDS.md`
- `docs/plans/PROJECT_PLAN_AND_STATUS.md`
- `docs/plans/EXECUTION_PLAN.md`
- `docs/plans/CORE_MODULES_DEV_PLAN.md`

## 后端开发规则

1. 新模型必须先改 `apps/api/prisma/schema.prisma`，再执行迁移。
2. 涉及跨模块联动必须优先用事件机制，不允许模块之间硬耦合直调。
3. 财务与金额字段优先使用高精度数值类型，禁止新增 Float 金额字段。
4. 业务状态变更必须通过 Workflow 能力，不允许随意跳状态。

## 前端开发规则

1. 优先复用元数据驱动组件：`DynamicView` / `FormEngine` / `ListEngine` / `KanbanEngine`。
2. 业务页面不允许复制粘贴同构 CRUD 代码。
3. API 调用统一走 `apps/web/src/lib/api.ts`。
4. 新增页面必须考虑移动端和窄屏可用性。

## 提交规范

使用 Conventional Commits:

- `feat(scope): ...`
- `fix(scope): ...`
- `refactor(scope): ...`
- `docs(scope): ...`
- `test(scope): ...`
- `chore(scope): ...`

示例:

- `feat(api): add stock picking aggregate endpoint`
- `fix(web): resolve order drawer form validation`
- `chore(db): add migration for decimal amount fields`

## 提交前检查

在仓库根目录执行:

```bash
npm run lint
npm run test
```

如果某个子应用未配置测试，至少确保可构建:

```bash
cd apps/api && npm run build
cd ../web && npm run build
```

## PR 要求

1. 说明背景、目标、影响范围。
2. 列出数据库变更和回滚方式（若有）。
3. 提供接口变更说明（若有）。
4. 前端改动附截图（若有）。
5. 必须通过 CI。