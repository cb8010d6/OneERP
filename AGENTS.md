# OneERP Agent Rules

This file is the cross-agent entry point for any AI coding agent.

## Read First

Before changing code, read these files in order:

1. `README.md`
2. `docs/README.md`
3. `docs/architecture/ARCHITECTURE.md`
4. `docs/architecture/DEVELOPMENT_WORKFLOW.md`
5. `docs/architecture/STANDARDS.md`
6. `docs/architecture/QUALITY_GATES.md`
7. The module files and tests related to the task

## Branch Rules

- Do not use `main` for daily development.
- Use `develop` as the integration branch.
- Use one task branch per agent: `agent/<scope>/<task>`.
- Open feature PRs into `develop`; open release PRs from `develop` into `main`.

Recommended scopes:

- `agent/api/<task>`
- `agent/web/<task>`
- `agent/db/<task>`
- `agent/test/<task>`
- `agent/docs/<task>`

## Ownership Rules

Only one agent may edit these high-conflict files at a time:

- `apps/api/prisma/schema.prisma`
- `apps/api/src/app.module.ts`
- `apps/web/src/lib/ui-schema.ts`
- `apps/api/src/core/**`
- `apps/web/src/components/core/**`
- `package.json`
- `package-lock.json`
- subproject lockfiles

## Engineering Rules

- New database fields require Prisma schema, migration, DTO/service updates, and tests.
- Cross-module business effects must use events or workflow hooks.
- Business status transitions must go through the workflow layer.
- Inventory must be changed through movement/transaction records, not direct quantity edits.
- Finance must be changed through journal entries, not direct balance edits.
- API input must use DTO validation.
- Web UI should reuse metadata-driven engines and `apps/web/src/lib/api.ts`.

## Validation

Use the smallest relevant check while developing, then run the full gate before merge:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npm run validate
```

If `npm run validate` fails, fix the first real failure before making more changes.

## Review Output

When an AI agent writes a code review, PR summary, or handoff review, it must include both Chinese and English sections. Keep the content equivalent, concise, and actionable.

Required format:

```md
## Review / 代码审查

### 中文
- 问题：
- 风险：
- 建议：
- 验证：

### English
- Findings:
- Risks:
- Suggestions:
- Verification:
```

If there are no findings, state that clearly in both languages and still mention remaining test gaps or residual risk.

## Task Card Template

```md
Goal:
Scope:
Forbidden files:
Read first:
Acceptance commands:
Related docs:
Related files:
```
