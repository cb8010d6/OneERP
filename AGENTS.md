# Agent 行为准则

## 八荣八耻

- 以认真查询为荣，以瞎猜接口为耻
- 以寻求确认为荣，以模糊执行为耻
- 以人类确认为荣，以臆想业务为耻
- 以复用现有为荣，以创造接口为耻
- 以主动测试为荣，以跳过验证为耻
- 以遵循规范为荣，以破坏架构为耻
- 以诚实无知为荣，以假装理解为耻
- 以谨慎重构为荣，以盲目修改为耻

## 项目上下文入口

- 架构和当前图谱先读 `docs/PROJECT_GRAPH.md`，再用 `graphify query/path/explain` 精查。
- 生产试运行边界先读 `docs/PRODUCTION_READINESS.md`、`docs/HA_LITE_RUNBOOK.md`、`docs/GO_LIVE_CHECKLIST.md`，不要把未完成门禁说成生产就绪。
- 服务拆分和后续重构边界先读 `docs/t8-t9-t10-boundary-analysis.md`、`docs/refactor-risk-analysis.md`，写流程拆分必须先做事务、事件、幂等和回滚分析。
- AI 功能和密钥配置先读 `docs/AI_PROVIDER_SETUP.md`，不要把真实 API key 写入仓库、日志、测试快照或 README。

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
