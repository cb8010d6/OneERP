# Multi-Agent Task Workflow

## Purpose

Use this runbook to create small, low-conflict tasks for multiple workers in the same repository.

## Branch Flow

1. Start from `develop`.
2. Create one task branch using `agent/<scope>/<task>`.
3. Keep the branch inside the task card scope.
4. Commit with a Conventional Commit message.
5. Open a PR into `develop`.

Recommended scopes:

- `agent/api/<task>`
- `agent/web/<task>`
- `agent/db/<task>`
- `agent/test/<task>`
- `agent/docs/<task>`

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

## Ownership Checklist

- One worker owns each high-conflict file at a time.
- Do not edit `schema.prisma`, app module files, core engine files, UI schema, core web components, or lockfiles unless assigned.
- A docs task should stay in `docs/`, `README.md`, and task card files unless explicitly expanded.
- A test task should avoid refactoring implementation unless the failing behavior cannot be fixed any other way.
- A DB task must include schema, migration, generated-client expectations, and API follow-up notes.

## Handoff Checklist

Before opening a PR, record:

- Changed files.
- Validation commands and results.
- Whether schema or migrations changed.
- Whether application code changed.
- Known blockers outside the branch.
- Follow-up task cards if the work uncovered new scope.

## Minimal Validation

Use the smallest relevant check while developing:

```bash
npm --prefix apps/api run test -- <module>
npm --prefix apps/web run test -- <area>
git diff --check
```

Before merge, run the full gate when the dependency state allows it:

```bash
npm run validate
```

If shared CI is failing before task-specific checks run, do not fix unrelated files on a scoped branch. Document the inherited failure in the PR.
