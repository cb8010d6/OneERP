# OneERP 标准开发工作流

> 最后更新：2026-05-05
> 目标读者：项目维护者、AI Agent、多 Agent 协作者

## 1. 当前结论

OneERP 不是需要推倒重来的仓库。它已经具备 NestJS API、Next.js Web、Prisma 数据模型、通用 CRUD、元数据 UI、工作流、审计、AI 命令、单元测试、E2E 测试和 GitHub Actions 的基础。当前主要风险不是“代码无救”，而是：

- 文档入口分散，agent 容易重复扫描全仓库，消耗 token。
- 业务模块完成度不均，采购、生产联动、财务冲销、RBAC、部署闭环仍需分阶段补齐。
- 本地 `main` 已承担开发分支职责，容易污染可发布主线。
- CI 一次跑全量验证，可靠但成本较高；若本地未跑同一组命令，GitHub Actions 会频繁暴露问题。
- 多 agent 同时改 Prisma schema、核心引擎、同一个业务 service 时很容易冲突。

## 2. 分支策略

建议立即采用三层主线：

| 分支 | 用途 | 保护策略 |
| --- | --- | --- |
| `main` | 生产发布分支，只接收稳定版本 | 禁止直接 push；必须 PR；必须通过 CI；用于触发 deploy |
| `develop` | 集成测试分支，所有功能先合入这里 | 禁止直接 push；必须 PR；通过 CI 后合入 |
| `agent/<scope>/<task>` | 单个 agent 或单个任务分支 | 小步提交，完成后 PR 到 `develop` |

推荐命名：

- `agent/api/purchase-order`
- `agent/web/finance-page`
- `agent/db/rbac-models`
- `fix/ci/prisma-migration`
- `docs/workflow-agent-guide`

标准流转：

```bash
git switch develop
git pull
git switch -c agent/api/purchase-order
# 开发、测试、提交
git push -u origin agent/api/purchase-order
# PR: agent/api/purchase-order -> develop
# develop 验证稳定后，发版 PR: develop -> main
```

## 3. GitHub Actions 策略

现有策略基本合理：PR 检查 `main/develop`，push 到 `develop` 跑 CI，push 到 `main` 部署。建议保持这个方向，但做三点优化：

1. `main` 只做发布，不做日常开发。
2. PR 到 `develop` 必须通过 `npm run validate`。
3. PR 到 `main` 只允许从 `develop` 发起，并保留人工 review。

CI 经常报错的常见来源：

- 本地没有先跑 `npm run validate`。
- Prisma schema 改了但缺 migration 或未运行 `prisma generate`。
- API/Web 子项目 lockfile 与根依赖不一致。
- 新增 DTO/Controller 后 TypeScript 或 ESLint 未过。
- 测试依赖外部服务，但 CI 只启动了 PostgreSQL。若测试真实依赖 Redis/MinIO，需要在 workflow 增加 service；若只是环境变量存在，测试应使用 mock 或降级。

降低 CI 报错的规则：

- 每个 PR 尽量只改一个业务边界。
- 数据库变更必须包含 schema、migration、相关 service 测试。
- 先在本地跑最小命令定位：`npm run typecheck`、`npm run lint`、`npm run test`。
- 合并前跑完整命令：`npm run validate`。
- 不允许用 `--fix` 改 CI；`lint:fix` 只能在本地执行并提交结果。

## 4. 多 Agent 协作边界

多 agent 看板式协作可以用，但必须按文件所有权拆任务，否则冲突会比人工开发更严重。

推荐拆分：

| Agent | 负责范围 | 禁止范围 |
| --- | --- | --- |
| DB Agent | `apps/api/prisma/schema.prisma`、新增 migration、seed | 不改 Web 页面 |
| API Agent | 单个业务模块 `apps/api/src/<module>/` | 不改核心 CRUD/Workflow，除非任务明确要求 |
| Web Agent | `apps/web/src/app/...`、业务组件 | 不改 Prisma/API service |
| Test Agent | 对应模块的 `*.spec.ts`、E2E | 不重构业务实现 |
| Docs Agent | `docs/`、README、PR 说明 | 不改运行时代码 |

高冲突文件一次只能给一个 agent：

- `apps/api/prisma/schema.prisma`
- `apps/api/src/app.module.ts`
- `apps/web/src/lib/ui-schema.ts`
- `apps/api/src/core/**`
- `apps/web/src/components/core/**`
- `package.json`、`package-lock.json`

每个 agent 开始前必须读：

1. `README.md`
2. `docs/architecture/ARCHITECTURE.md`
3. `docs/architecture/STANDARDS.md`
4. `docs/architecture/QUALITY_GATES.md`
5. `docs/architecture/DEVELOPMENT_WORKFLOW.md`
6. 与任务相关的模块文件和测试

每个 agent 交付时必须写明：

- 改了哪些文件。
- 如何验证。
- 未完成风险。
- 是否涉及 schema/migration。
- 是否影响 `main` 发布。

## 5. 降低 Token 消耗的做法

不要让 agent 每次“重新理解整个 ERP”。每个任务卡片必须包含固定上下文：

```md
目标：
范围：
禁止修改：
必须先读：
验收命令：
相关文档：
相关文件：
```

推荐任务模板：

```md
目标：实现采购订单提交后生成收货待办。
范围：apps/api/src/purchase-orders/**，必要时新增测试。
禁止修改：schema.prisma、core/workflow、web 页面。
必须先读：ARCHITECTURE.md、STANDARDS.md、QUALITY_GATES.md、purchase-orders.service.ts。
验收命令：npm --prefix apps/api run test -- purchase-orders。
相关文档：docs/plans/CORE_MODULES_DEV_PLAN.md。
```

## 6. 新手维护流程

日常开发按这个顺序执行：

1. 从 `develop` 新建任务分支。
2. 阅读任务相关文档和模块，不全仓库乱扫。
3. 写最小可运行改动。
4. 为业务规则补测试。
5. 本地先跑模块级测试，再跑根目录 `npm run validate`。
6. 提交 Conventional Commit。
7. 开 PR 到 `develop`。
8. CI 通过后合并。
9. 一批功能在 `develop` 稳定后，从 `develop` 开 PR 到 `main`。
10. `main` 合并后触发部署或手动发布。

新手不要做的事：

- 不要直接在 `main` 开发。
- 不要一次让 agent 改前端、后端、数据库、CI、文档。
- 不要让多个 agent 同时改 schema 或 lockfile。
- 不要跳过测试后再让 CI “帮忙发现问题”。
- 不要为了页面快而绕过元数据、CRUD、Workflow、Audit 这些内核规则。

## 7. AI Agent 工具与 Skill 策略

OneERP 系统内的 AI 模块已有工具雏形：

- `create_resource`
- `transition_workflow`
- `chat2dash_query`
- `chat2sql_read`
- `parse_document_draft`

建议后续补齐“项目维护型 skill/工具”，让 agent 遇到问题优先查本地知识：

| 工具/Skill | 作用 |
| --- | --- |
| `read_architecture` | 汇总架构、模块边界、核心红线 |
| `read_quality_gates` | 返回本地与 CI 验证命令 |
| `module_playbook` | 按模块返回开发步骤、测试入口、常见坑 |
| `migration_guard` | 检查 schema 与 migration 是否同步 |
| `ci_failure_triage` | 根据 Actions 日志分类定位失败原因 |
| `agent_task_template` | 生成低 token 的任务卡片 |

短期内不必开发复杂 MCP。先把这些能力沉淀为文档和通用任务模板，收益最高。

## 8. 可靠性评估

和 Odoo、ERPNext、SAP Business One、金蝶、用友这类成熟系统相比，OneERP 还不是可直接生产替代的成熟 ERP。它更像一个有正确架构方向的早期工程底座：

- 架构方向合理：元数据、通用 CRUD、事件、工作流、审计、AI 入口都已存在。
- 完善度不足：采购、财务、生产、权限、部署、监控、备份、审计查询还需要补齐。
- 可靠性取决于测试和流程：只要坚持分支保护、模块边界、migration 纪律、质量门禁，它可以继续演进；如果继续在 `main` 上堆功能，会快速失控。

当前代码还有救，且不建议重写。正确做法是冻结主线、拆分任务、补齐质量门禁、逐模块验收。
