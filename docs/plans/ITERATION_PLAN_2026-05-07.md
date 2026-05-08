# OneERP 2026-05-07 迭代计划

> 制定时间：2026-05-06  
> 目标：基于当前 `develop` 基线，优先修复可运行性、安全风险和核心业务闭环，再推进功能完善。  
> 执行方式：所有任务从 `develop` 新建 `agent/<scope>/<task>` 分支，PR 合并回 `develop`；阶段稳定后从 `develop` 发 release PR 到 `main`。

## 1. 本次会话总结

### 1.1 项目治理与文档基线

本次会话先围绕 token 消耗、文档完善、CI/CD、AI agent 协作和新手维护方式进行了整理，形成了以下共识：

- `main` 作为稳定发布分支，`develop` 作为集成分支，日常开发使用 `agent/<scope>/<task>` 任务分支。
- 文档入口以 `AGENTS.md`、`docs/README.md`、`docs/architecture/*`、`docs/plans/*` 为主，避免 AI agent 每次全仓库重新理解。
- 多 agent 可以并行，但 `schema.prisma`、核心引擎、lockfile、全局 UI schema 等高冲突文件必须单任务独占。
- 本地验证优先于 CI 兜底，最小验证通过后再跑完整质量门禁。

已完成：

- 整理并强化了 AI agent 行为规则、开发工作流、质量门禁、模块 runbook。
- 建立了 `develop -> main` 的发布思路。
- 合入并检查过一批模块分支：库存拣货、财务断言、Web dashboard warning、双语 review 规则等。

### 1.2 本地运行与登录链路

本次会话中暴露了几个本地运行问题：

- 用户在根目录执行 `npm --prefix apps/api exec prisma -- db push --schema=./prisma/schema.prisma` 时路径错误，正确路径应为 `apps/api/prisma/schema.prisma`。
- Prisma 7 全局 CLI 与项目 Prisma 5 客户端不兼容，项目应优先使用 `npm --prefix apps/api exec prisma -- ...` 或项目 scripts。
- API 端口 8000 曾被旧 `dist` 进程占用，导致浏览器看到的行为与当前源码不一致。
- 登录接口命令行可用，但浏览器报 `Network Error`。最终定位为前端 CSP `connect-src` 不允许直连 `localhost:8000`。

已完成修复：

- 前端默认 API 地址改为同源代理 `/api/proxy`。
- Next.js rewrite 默认代理到 `http://127.0.0.1:8000/api`。
- 登录页错误信息改为显示真实网络/HTTP 原因，避免只显示兜底文案。
- 登录返回的 user 只包含 `email/name` 时，前端会规范化为 dashboard 可用的 `username/role`。
- 登录页视觉从“智能制造 EIP 全局系统”调整为更正式的 OneERP Operations Platform。

### 1.3 后端运行时修复

已完成修复：

- 修复 `PrismaService` 租户隔离模型白名单。此前 `StockQuant`、`OrderItem`、`WorkflowState` 等没有直接 `companyId` 的子表被自动注入 `companyId`，导致 dashboard 统计 500。
- `DashboardService.getStats()` 已能返回正常统计。
- CacheModule 暂时改为内存缓存，避免当前 cache-manager 与 Redis store 配置不匹配造成运行时问题。
- API Swagger 标题改为 OneERP API。
- API 启动日志端口改为读取实际 `PORT`。
- 注册重复邮箱从 `401 Unauthorized` 改为 `409 Conflict`。
- Chat2SQL 原始 SQL 执行默认关闭，需显式设置 `ENABLE_UNSAFE_CHAT2SQL=true` 才允许进入旧实现。
- 删除遗留调试脚本 `write_kysely.js`。
- 移除 `docker-compose.yml` 已废弃的 `version` 字段。

### 1.4 当前仍暴露的浏览器问题

用户在浏览器标注了三个仍需处理的问题：

| 问题 | 页面 | 当前表现 | 初步判断 |
| --- | --- | --- | --- |
| 采购订单错误 | `/dashboard/dynamic/purchaseOrder` | `Request failed with status code 404` | 动态资源模型名、metadata model 名或通用 CRUD resource 名不一致 |
| 员工与账号错误 | `/dashboard/settings` | `Request failed with status code 500` | 用户/角色接口在租户上下文或关系 include 上存在运行时错误 |
| 组织架构错误 | `/dashboard/settings` | `Request failed with status code 500` | 部门接口或 settings 页面数据契约不一致 |

这三项是 2026-05-07 的首要修复目标。

## 2. 外部分析报告重点结论

用户提供的 `project_analysis.md` 对项目的判断总体可采纳，但需要结合当前代码状态修正优先级：

### 2.1 已被当前基线部分处理

| 报告问题 | 当前状态 |
| --- | --- |
| JWT 无过期时间 | 当前 `AuthModule` 已设置 `expiresIn: '7d'`，但仍缺 refresh token 和短期 access token 策略 |
| 调试脚本残留 | 本轮已删除 `write_kysely.js`；仍需再次全仓库扫描确认是否还有 `run_fix*.js` |
| 注册重复邮箱返回 401 | 本轮已改为 `ConflictException` |
| API 日志硬编码 8000 | 本轮已改为动态端口 |
| docker compose version key | 本轮已移除 |
| Chat2SQL 注入风险 | 本轮已默认关闭旧 SQL 执行；完整 AST 白名单重构仍未完成 |

### 2.2 仍是 P0/P1 的真实风险

| 风险 | 等级 | 原因 |
| --- | --- | --- |
| Chat2SQL 安全重构 | P0 | 当前只是关闭风险入口，未提供安全可用替代实现 |
| 金额字段 Float | P0 | 财务系统长期不可接受，但迁移影响大，需独立分支和数据迁移策略 |
| 采购/设置页运行时错误 | P0 | 影响本地演示和核心业务可用性 |
| E2E 测试缺失 | P1 | 当前多处错误只能靠手工点击发现 |
| 前端模块入口不完整 | P1 | 财务、生产、部门等模块未形成统一工作台体验 |
| monorepo workspaces 不规范 | P1 | 影响依赖一致性与 CI 稳定性，需要谨慎迁移 lockfile |

## 3. 明天执行顺序

### 阶段 A：恢复本地业务可用性

目标：让登录、概览、采购订单、员工账号、组织架构这些基础页面在本地无红色错误。

| 顺序 | 分支 | 任务 | 验收 |
| --- | --- | --- | --- |
| A1 | `agent/web/api-proxy-login-stabilize` | 复查 `/api/proxy` 登录、dashboard stats、orders 请求路径，补 API client 测试 | 登录后不再 `Network Error`；`npm --prefix apps/web run test -- api.test.ts LoginPage.test.tsx --runInBand` |
| A2 | `agent/api/dynamic-purchase-order-fix` | 定位 `/dashboard/dynamic/purchaseOrder` 404，统一 metadata model、Prisma model、resource route 的命名 | 页面能加载采购订单列表或明确空态；API 404 消失 |
| A3 | `agent/api/settings-users-fix` | 修复 settings 员工与账号 500，检查 `/api/users` 的 include、tenant guard、返回 DTO | 员工与账号 tab 正常显示；API 返回 200 |
| A4 | `agent/api-settings-departments-fix` | 修复组织架构 500，检查 departments controller/service 与前端契约 | 组织架构 tab 正常显示；API 返回 200 |

执行前先记录真实错误：

```bash
git switch develop
git pull
docker compose up -d
set DATABASE_URL=postgresql://eip_user:eip_password@localhost:5432/eip_db
npm --prefix apps/api run start:dev
npm --prefix apps/web run dev
```

然后分别访问：

- `http://localhost:3000/login`
- `http://localhost:3000/dashboard`
- `http://localhost:3000/dashboard/dynamic/purchaseOrder`
- `http://localhost:3000/dashboard/settings`

### 阶段 B：安全底线

目标：不让高风险 AI/认证能力带着隐患进入 main。

| 顺序 | 分支 | 任务 | 验收 |
| --- | --- | --- | --- |
| B1 | `agent/api/chat2sql-safe-readonly` | 使用 SQL AST parser 或严格白名单查询构造器替代 `$queryRawUnsafe`；保留 `companyId` 强制过滤 | 禁止 DDL/DML/多语句/系统表；新增单元测试覆盖绕过场景 |
| B2 | `agent/api/auth-refresh-token` | 设计 access token + refresh token；access token 缩短有效期；refresh token 可撤销 | 登录、刷新、登出测试通过 |
| B3 | `agent/docs/security-runbook` | 增加安全 runbook，说明 Chat2SQL、JWT、CORS/CSP、tenant isolation 约束 | 文档可作为 AI agent 任务入口 |

说明：金额 Decimal 迁移也是 P0，但需要 schema、migration、service、测试联动，建议排在业务页面恢复之后。

### 阶段 C：财务精度与数据迁移

目标：解决 Float 金额问题，但避免一次性破坏全系统。

| 顺序 | 分支 | 任务 | 验收 |
| --- | --- | --- | --- |
| C1 | `agent/db/money-decimal-audit` | 列出所有金额/单价/税额/借贷字段，区分财务核心字段和非核心估算字段 | 输出字段清单和迁移策略 |
| C2 | `agent/db/money-decimal-migration` | 将核心财务字段迁移为 Decimal，补 DTO/service 转换 | Prisma migrate + API typecheck/test 通过 |
| C3 | `agent/api/finance-decimal-tests` | 补凭证借贷平衡、发票/付款金额精度测试 | 测试覆盖小数精度场景 |

### 阶段 D：业务闭环与 E2E

目标：让系统从“模块存在”变成“业务能走通”。

| 顺序 | 分支 | 任务 | 验收 |
| --- | --- | --- | --- |
| D1 | `agent/test/e2e-sales-inventory-finance` | 增加销售订单 → 发货 → 库存过账 → 财务凭证 E2E | E2E 在本地和 CI 可跑 |
| D2 | `agent/api/purchase-end-to-end` | 采购订单 → 收货入库 → 应付账款闭环 | 采购主流程有 API 测试 |
| D3 | `agent/web/module-navigation-completion` | 补财务、生产、部门、动态资源入口，减少隐藏页面 | 侧栏覆盖核心模块 |
| D4 | `agent/web/settings-operational-polish` | settings 页面增加加载态、空态、错误详情、重试按钮 | 用户可理解错误，不再只有 Axios 文案 |

### 阶段 E：仓库工程化

目标：降低 CI 报错和新手维护难度。

| 顺序 | 分支 | 任务 | 验收 |
| --- | --- | --- | --- |
| E1 | `agent/tooling/workspaces-design` | 评估 npm workspaces 迁移方案，不直接大改 lockfile | 输出方案文档和风险 |
| E2 | `agent/test/remove-web-lint-warnings` | 逐步清理 Web 现有 59 个 lint warning | `npm --prefix apps/web run lint` 无 warning 或显著减少 |
| E3 | `agent/ci/next-root-warning` | 处理 Next.js 多 lockfile root warning | `npm --prefix apps/web run build` 不再提示 root 推断 |
| E4 | `agent/docs/local-business-test-guide` | 补本地部署与业务能力测试手册 | 新手可按文档完成登录、采购、库存、财务验证 |

## 4. 明天任务卡片模板

每个 agent 必须按以下模板领取任务：

```md
Goal:
Scope:
Forbidden files:
Read first:
Acceptance commands:
Manual browser checks:
Known risks:
PR target: develop
```

示例：

```md
Goal: 修复采购订单动态页面 404。
Scope: apps/web/src/app/dashboard/dynamic/**, apps/web/src/lib/ui-schema.ts, apps/api/src/core/metadata/**, apps/api/src/core/crud/**
Forbidden files: apps/api/prisma/schema.prisma, package-lock.json
Read first: docs/architecture/ARCHITECTURE.md, docs/architecture/STANDARDS.md, docs/runbooks/purchase-receiving.md
Acceptance commands:
- npm --prefix apps/api run typecheck
- npm --prefix apps/web run typecheck
- npm --prefix apps/web run test -- DynamicView.test.tsx --runInBand
Manual browser checks:
- /dashboard/dynamic/purchaseOrder loads without 404
Known risks: model name may be PurchaseOrder while route uses purchaseOrder.
PR target: develop
```

## 5. 今日基线提交说明

今日准备推送到远端 `develop` 的基线包含：

- 登录页视觉升级和登录 user normalization。
- 前端 API 同源代理 `/api/proxy`，修复 CSP 导致的 browser `Network Error`。
- dashboard stats 相关租户隔离修复。
- CacheModule 临时改为内存缓存。
- Chat2SQL 危险执行默认关闭。
- 注册冲突码、API 动态端口、docker compose version 清理、遗留脚本清理。

已知仍未解决：

- `/dashboard/dynamic/purchaseOrder` 仍需专项修复。
- `/dashboard/settings` 的员工账号和组织架构仍需专项修复。
- Chat2SQL 只是关闭风险入口，未完成安全可用替代实现。
- Float 金额字段仍未迁移。
- Web lint 仍有既有 warning。
