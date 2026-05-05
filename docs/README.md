# OneERP 文档索引

> 最后更新：2026-05-05
> 目标：让新手和 AI Agent 用最少上下文接手项目。

## 必读入口

| 文档 | 用途 |
| --- | --- |
| [`../AGENTS.md`](../AGENTS.md) | 所有 agent 的统一行为规范 |
| [`architecture/ARCHITECTURE.md`](architecture/ARCHITECTURE.md) | 当前系统架构全景 |
| [`architecture/DEVELOPMENT_WORKFLOW.md`](architecture/DEVELOPMENT_WORKFLOW.md) | 分支、CI、多 agent、新手维护流程 |
| [`architecture/STANDARDS.md`](architecture/STANDARDS.md) | 代码规范和架构红线 |
| [`architecture/QUALITY_GATES.md`](architecture/QUALITY_GATES.md) | 本地验证与 GitHub Actions 门禁 |
| [`AI_INSTRUCTIONS.md`](AI_INSTRUCTIONS.md) | AI Agent 接手任务说明 |

## 计划与状态

| 文档 | 用途 |
| --- | --- |
| [`plans/PROJECT_PLAN_AND_STATUS.md`](plans/PROJECT_PLAN_AND_STATUS.md) | 当前阶段状态与治理策略 |
| [`plans/CORE_MODULES_DEV_PLAN.md`](plans/CORE_MODULES_DEV_PLAN.md) | 采购、财务、生产、权限、AI 工具开发计划 |
| [`architecture/BACKLOG.md`](architecture/BACKLOG.md) | P1/P2 缺口与待办 |
| [`analysis/MISSING_FEATURES_ANALYSIS.md`](analysis/MISSING_FEATURES_ANALYSIS.md) | 缺失功能分析 |

## 专题规范

| 文档 | 用途 |
| --- | --- |
| [`architecture/DOMAIN_FLOW.md`](architecture/DOMAIN_FLOW.md) | 业务流与跨模块事件 |
| [`architecture/MIGRATION_POLICY.md`](architecture/MIGRATION_POLICY.md) | 数据库迁移策略 |
| [`deployment.md`](deployment.md) | 部署说明 |

## 已归档文档

旧版计划和基线文档已移入 [`archive/`](archive/)，只作为历史参考，不再作为 agent 的主要上下文。

| 归档文档 | 替代入口 |
| --- | --- |
| `archive/PROJECT_PLAN.legacy.md` | `plans/PROJECT_PLAN_AND_STATUS.md` |
| `archive/EXECUTION_PLAN.legacy.md` | `architecture/DEVELOPMENT_WORKFLOW.md` + `plans/CORE_MODULES_DEV_PLAN.md` |
| `archive/ARCHITECTURE_BASELINE.legacy.md` | `architecture/ARCHITECTURE.md` |

## 维护规则

- 新增规则优先放入 `architecture/STANDARDS.md` 或 `architecture/QUALITY_GATES.md`。
- 新增业务计划优先放入 `plans/CORE_MODULES_DEV_PLAN.md`。
- 新增 agent 行为约束优先更新 `AGENTS.md`；工具适配文件只同步必要摘要。
- 不再新增散落的 `TODO.md`、`plan.md`、`handover.md`；统一进入 `BACKLOG.md` 或计划文档。

## 工具适配

仓库可以保留不同 AI 工具自动读取的适配文件。这些文件只同步摘要，权威规则以 `AGENTS.md` 和 `docs/architecture/` 为准。
