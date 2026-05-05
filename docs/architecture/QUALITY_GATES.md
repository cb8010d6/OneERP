# 🚦 OneERP Quality Gates (质量闸门)

> 最后更新：2026-05-05 · 版本：1.0.0
> 维护人：项目总结构师

---

## 1. 核心原则

> **本地与 CI 使用完全相同的命令序列，保证"本地能过 → CI 一定能过"。**

所有质量验证统一通过根目录 `package.json` 中的 npm scripts 入口执行。

---

## 2. 统一命令表

### 2.1 根目录命令（推荐日常使用）

| 命令               | 说明                                    | CI 使用 | 本地使用 |
| ------------------ | --------------------------------------- | ------- | -------- |
| `npm run validate` | **终极闸门**：串联执行全部检查          | ✅      | ✅       |
| `npm run typecheck` | 前后端 TypeScript 严格类型检查         | ✅      | ✅       |
| `npm run lint`     | ESLint 规则检查（不自动修复）           | ✅      | ✅       |
| `npm run test`     | 前后端单元测试                          | ✅      | ✅       |
| `npm run build`    | 前后端生产编译                          | ✅      | ✅       |
| `npm run seed`     | 种子数据初始化                          | ❌      | ✅       |
| `npm run commitlint` | 校验最近一次 commit message           | ✅ (PR) | ❌       |

### 2.2 `validate` 命令执行序列

```bash
npm run validate
# 等价于:
# 1. prisma validate --schema=./prisma/schema.prisma
# 2. prisma generate --schema=./prisma/schema.prisma
# 3. npm run typecheck  (api + web)
# 4. npm run lint       (api + web)
# 5. npm run test       (api + web)
# 6. npm run build      (api + web)
```

### 2.3 API 专用命令 (`apps/api`)

| 命令                        | 说明                           |
| --------------------------- | ------------------------------ |
| `npm run typecheck`         | `tsc --noEmit`                 |
| `npm run lint`              | ESLint 不修复                  |
| `npm run lint:fix`          | ESLint 自动修复（仅限本地）    |
| `npm run format`            | Prettier 格式化                |
| `npm run test`              | Jest 单元测试                  |
| `npm run test:cov`          | Jest 测试 + 覆盖率             |
| `npm run test:e2e`          | Jest E2E 测试                  |
| `npm run build`             | `nest build`                   |
| `npm run start:dev`         | 开发模式热重载                 |
| `npm run prisma:validate`   | Prisma schema 语法校验         |
| `npm run prisma:generate`   | 生成 Prisma Client             |

### 2.4 Web 专用命令 (`apps/web`)

| 命令                | 说明                          |
| ------------------- | ----------------------------- |
| `npm run dev`       | Next.js 开发服务器            |
| `npm run build`     | Next.js 生产编译              |
| `npm run typecheck` | `tsc --noEmit`                |
| `npm run lint`      | ESLint 不修复                 |
| `npm run lint:fix`  | ESLint 自动修复（仅限本地）   |
| `npm run test`      | Jest 单元测试                 |

---

## 3. CI 流水线详解

### 3.1 PR 检查 (`ci.yml`)

```
触发: pull_request → main/develop, push → develop

Job 1: commitlint (仅 PR)
├─ checkout (fetch-depth: 0)
├─ npm ci
└─ npx commitlint --from=base --to=head

Job 2: validate
├─ 启动 PostgreSQL 15 service
├─ npm ci (root + api + web)
├─ npx prisma migrate deploy
└─ npm run validate
    ├─ prisma validate + generate
    ├─ typecheck (api + web)
    ├─ lint (api + web)
    ├─ test (api + web)
    └─ build (api + web)
```

### 3.2 部署流水线 (`deploy.yml`)

```
触发: push → main, workflow_dispatch

Job 1: build-api → Docker Build & Push to GHCR
Job 2: build-web → Docker Build & Push to GHCR
Job 3: deploy    → (placeholder, 需配置 SSH/Docker Compose)
```

### 3.3 分支门禁建议

| 分支 | 允许来源 | 必须检查 | 触发结果 |
| ---- | -------- | -------- | -------- |
| `agent/*` | 本地任务分支 | 模块级测试 + 需要时 `npm run validate` | 开 PR 到 `develop` |
| `develop` | `agent/*` / `fix/*` PR | `commitlint` + `validate` | 集成测试分支 |
| `main` | `develop` PR | `commitlint` + `validate` + 人工 review | 触发部署 |

建议在 GitHub Branch protection 中禁止直接 push 到 `main` 和 `develop`。

---

## 4. 本地开发工作流

### 4.1 提交前检查

```bash
# 完整验证（推荐，与 CI 完全一致）
npm run validate

# 或分步执行（用于快速定位问题）
npm run typecheck
npm run lint
npm run test
npm run build
```

### 4.2 自动修复

```bash
# ESLint 自动修复（CI 禁止使用 --fix）
npm --prefix apps/api run lint:fix
npm --prefix apps/web run lint:fix

# Prettier 格式化
npm --prefix apps/api run format
```

### 4.3 数据库操作

```bash
# 验证 schema
npm --prefix apps/api run prisma:validate

# 生成 Prisma Client
npm --prefix apps/api run prisma:generate

# 创建新 migration（开发环境）
cd apps/api
npx prisma migrate dev --name your_migration_name
```

---

## 5. 提交规范

### 5.1 Commit Message 格式

```
<type>(<scope>): <subject>
```

**Type**: `feat` / `fix` / `refactor` / `chore` / `docs` / `test` / `ci` / `style`

**Scope**: `api` / `web` / `core` / `prisma` / `db`

**示例**:
```
feat(api): add finance dlq retry endpoint
fix(web): fix dynamic form date field parsing
chore(prisma): add migration for account constraints
docs(arch): add architecture baseline document
```

### 5.2 Husky Git Hooks

| Hook          | 执行内容                             |
| ------------- | ------------------------------------ |
| `commit-msg`  | commitlint 校验 commit message 格式  |

---

## 6. 代码审查 Checklist

### PR 必须满足

- [ ] 本地 `npm run validate` 100% 通过
- [ ] Commit message 符合 Conventional Commits 规范
- [ ] 无 `any` 类型（除非有 `eslint-disable` + 充分理由）
- [ ] 无未使用的变量或导入
- [ ] 新增 API 端点有 Swagger 注解
- [ ] 新增 API 端点有对应 DTO 和验证
- [ ] 涉及数据库变更附 migration 和回填脚本
- [ ] 涉及 UI 改动附截图
- [ ] 描述中写明影响范围

### 核心架构区额外要求

修改 `src/core/crud/`、`src/core/metadata/`、`src/core/workflow/` 等引擎模块时：

- [ ] 必须获得 Core Team 审批
- [ ] 必须有对应的单元测试覆盖
- [ ] 必须评估对现有业务模块的影响

---

## 7. 环境变量

| 变量               | 说明           | CI 默认值                                      |
| ------------------ | -------------- | ---------------------------------------------- |
| `DATABASE_URL`     | PostgreSQL     | `postgresql://eip_user:eip_password@localhost:5432/eip_db_test` |
| `JWT_SECRET`       | JWT 密钥       | `test_secret_for_ci`                           |
| `PORT`             | API 端口       | `8000`                                         |
| `CORS_ORIGINS`     | CORS 白名单    | `localhost:3000,5173,8080`                     |
| `REDIS_HOST`       | Redis 地址     | `localhost`                                    |
| `MINIO_ENDPOINT`   | MinIO 地址     | `localhost`                                    |

> 注意：当前 CI workflow 只启动 PostgreSQL service。若测试真实访问 Redis 或 MinIO，需要在 `.github/workflows/ci.yml` 中增加对应 service；若测试只验证业务逻辑，应使用 mock 或本地降级，避免 CI 因外部服务缺失而不稳定。
