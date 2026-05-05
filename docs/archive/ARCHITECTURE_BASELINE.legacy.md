# 🏛️ OneERP Architecture Baseline

> 最后更新：2026-05-05 · 版本：1.0.0
> 维护人：项目总结构师

---

## 1. 系统总览

OneERP 是一套面向制造与供应链场景的 AI Native ERP，采用 **元数据驱动 + 事件驱动 + 多端协同** 架构。

```
┌─────────────────────────────────────────────────────────────┐
│                        clients                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  web     │  │ desktop  │  │  mobile  │  │  Swagger │    │
│  │ Next.js  │  │ Electron │  │ React    │  │   UI     │    │
│  │ 16 + R19 │  │          │  │ Native   │  │          │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
│       └──────────────┴──────────────┴──────────────┘         │
│                          │  HTTP / REST                      │
│                          ▼                                   │
│  ┌──────────────────────────────────────────────────────┐    │
│  │              API (NestJS 11) port 8000 /api          │    │
│  └──────────────────────────────────────────────────────┘    │
│       ┌──────────────────┼──────────────────┐                │
│       ▼                  ▼                  ▼                │
│  ┌─────────┐      ┌───────────┐      ┌──────────┐           │
│  │ Postgres│      │   Redis   │      │  MinIO   │           │
│  │  15     │      │    7      │      │  Object  │           │
│  └─────────┘      └───────────┘      └──────────┘           │
└─────────────────────────────────────────────────────────────┘
```

### 技术栈

| 层       | 技术                                     |
| -------- | ---------------------------------------- |
| Web 前端 | Next.js 16, React 19, Tailwind 4, Zustand, TanStack Table |
| 移动端   | React Native (Expo)                      |
| 桌面端   | Electron                                 |
| API      | NestJS 11, TypeScript 5.7 (strict)       |
| ORM      | Prisma 5.22 + Kysely 0.28 (聚合查询)     |
| 数据库   | PostgreSQL 15                            |
| 缓存     | Redis 7 (ioredis)                        |
| 文件存储 | MinIO (S3 兼容)                           |
| 认证     | Passport + JWT                           |
| 事件总线 | @nestjs/event-emitter (EventEmitter2)     |
| CI/CD    | GitHub Actions → Docker → GHCR           |
| 代码规范 | ESLint 9 + Prettier + commitlint + husky |

---

## 2. 模块拓扑 (Module Map)

### 2.1 根模块注册顺序 (`app.module.ts`)

```
AppModule
├── EventEmitterModule.forRoot()        ← 进程内事件总线
├── AppCacheModule                      ← Redis 缓存
├── KyselyModule                        ← Kysely 查询引擎
├── PrismaModule                        ← Prisma ORM 单例
├── MetadataModule                      ← 元数据字典 / 自定义字段
├── WorkflowModule                      ← 状态机引擎
├── AuditModule                         ← 审计日志
├── AIModule                            ← AI 摘要
├── CrudModule                          ← 通用 CRUD 网关
├── AuthModule                          ← 认证 / JWT
├── UsersModule                         ← 用户管理
├── OrdersModule                        ← 订单管理
├── FilesModule                         ← 文件上传
├── InventoryModule                     ← 智能仓储
├── DashboardModule                     ← 仪表盘
├── ProductionModule                    ← 生产管理
├── FinanceModule                       ← 财务管理
└── DepartmentsModule                   ← 部门管理
```

### 2.2 模块边界职责

| 模块              | 目录                              | 核心职责                                           | 对外导出                |
| ----------------- | --------------------------------- | -------------------------------------------------- | ----------------------- |
| **Core / CRUD**   | `src/core/crud/`                  | 通用 REST CRUD 引擎，元数据驱动动态查询            | —                       |
| **Core / Metadata** | `src/core/metadata/`            | 自定义字段定义、Schema 查询                        | —                       |
| **Core / Workflow** | `src/core/workflow/`            | 状态机定义、流转执行、事件发射                     | `WorkflowService`       |
| **Core / Audit**  | `src/core/audit/`                 | CRUD 审计日志、时间线、评论                        | `AuditService`          |
| **Core / Events** | `src/core/events/`               | 事件入队 / 重试 / DLQ / 幂等                      | `EventQueueModule`      |
| **Core / Tenant** | `src/core/tenant/`               | 多租户上下文 (CompanyId / UserId)                  | `TenantContext`         |
| **Core / AI**     | `src/core/ai/`                    | AI 摘要生成                                        | —                       |
| **Orders**        | `src/orders/`                     | 销售订单 CRUD，创建后自动发布 `order.created` 事件 | —                       |
| **Inventory**     | `src/inventory/`                  | 复式库存过账 (入库/出库/移库)，实时台账            | `InventoryService`      |
| **Production**    | `src/production/`                 | 工单管理、报工                                     | —                       |
| **Finance**       | `src/finance/`                    | 发票、收款、自动记账凭证                           | `AccountingService`, `FinanceDlqService` |
| **Users**         | `src/users/`                      | 用户 CRUD、角色分配                                | —                       |
| **Auth**          | `src/auth/`                       | 登录、JWT 策略                                     | —                       |
| **Files**         | `src/files/`                      | MinIO 文件上传/下载                                | —                       |
| **Departments**   | `src/departments/`                | 部门管理                                           | —                       |
| **Dashboard**     | `src/dashboard/`                  | 统计聚合                                           | —                       |

### 2.3 模块依赖图

```
OrdersModule ──imports──▶ InventoryModule ──imports──▶ KyselyModule
      │
      └──imports──▶ EventQueueModule
                        │
FinanceModule ──imports──┘
      │
      └──imports──▶ PrismaModule

ProductionModule ──imports──▶ PrismaModule

WorkflowModule (standalone, uses EventEmitter2)
AuditModule    (standalone, uses PrismaModule)
CrudModule     (standalone, uses MetadataModule + AuditModule)
```

> **规则**：业务模块禁止反向依赖 `core/` 子模块以外的其他业务模块，跨模块交互必须通过事件。

---

## 3. 事件总线 (Event Bus)

系统使用 `@nestjs/event-emitter`（基于 EventEmitter2）实现进程内事件驱动。所有关键业务流转通过事件解耦。

### 3.1 事件注册表

| 事件名                                  | 发射方             | 消费方                    | 触发时机                 |
| --------------------------------------- | ------------------ | ------------------------- | ------------------------ |
| `order.created`                         | `OrdersService`    | `OrderCreatedListener`    | 订单创建成功后           |
| `workflow.action.sale_order.confirmed`  | `WorkflowService`  | —                         | 订单确认                 |
| `workflow.action.sale_order.in_production` | `WorkflowService` | —                       | 订单进入生产             |
| `workflow.action.sale_order.shipped`    | `WorkflowService`  | `OrderWorkflowListener`   | 订单发货                 |
| `workflow.action.sale_order.completed`  | `WorkflowService`  | —                         | 订单完成                 |
| `workflow.action.sale_order.cancelled`  | `WorkflowService`  | —                         | 订单取消                 |
| `inventory.stock_depleted`              | `InventoryService` | `FinanceBridgeListener`   | 出库过账完成             |
| `finance.invoice.posted`                | `FinanceService`   | `FinanceBridgeListener`   | 发票过账完成             |

### 3.2 事件流转链

```
[订单创建] ──order.created──▶ [库存检查] ──低库存告警──▶ AuditLog
                                 │
[订单发货] ──workflow.shipped──▶ [自动出库] ──stock_depleted──▶ [自动记账凭证]
                                     │                              │
                                     └── 订单状态→SHIPPED           └── JournalEntry (INV)

[发票过账] ──invoice.posted──▶ [自动记账凭证]
                                    │
                                    └── JournalEntry (SAL)
```

### 3.3 幂等与重试机制 (`EventQueueService`)

- **幂等**：通过 `idempotencyKey` 去重，已 RESOLVED 的事件不重复处理
- **重试**：指数退避，基础 30s，最大 30min，最多 `maxAttempts` 次（默认 5）
- **DLQ**：超过重试上限的事件标记为 FAILED，存入 `EventDlq` 表
- **存储**：使用 PostgreSQL `EventDlq` 表持久化事件队列

### 3.4 财务桥接 (`FinanceBridgeListener`)

```
inventory.stock_depleted ──▶ postStockDepletedEntry()
                              借: 6401 主营业务成本
                              贷: 1405 库存商品

finance.invoice.posted   ──▶ postInvoicePostedEntry()
                              借: 1122 应收账款
                              贷: 6001 主营业务收入
                              贷: 222101 应交税费-销项税
```

失败时写入 `FinanceDlqService`，由定时任务 `retryPending()` 重试。

---

## 4. 数据模型概览

### 4.1 核心实体关系

```
Company (1) ──< UserCompanyRole >── (N) User
    │                                      │
    ├── (N) Partner ◀────────── Order ─────┘ (salesId)
    ├── (N) Warehouse ──< StockLocation ──< StockQuant
    ├── (N) Material ──────────────────────< StockQuant
    ├── (N) Product ──┐
    │                  └── Bom ──< BomLine
    ├── (N) Order ──< OrderItem
    │      │
    │      ├── (N) WorkOrder ──< WorkReport
    │      └── (N) Invoice ──< Payment
    │
    ├── (N) Account ──< JournalEntryLine
    ├── (N) Journal ──< JournalEntry
    ├── (N) TaxCode ──┐
    │                  └── Account (accountId)
    ├── (N) Workflow ──< WorkflowState ──< WorkflowTransition
    ├── (N) AuditLog
    ├── (N) EventDlq
    └── (N) CustomFieldDefinition
```

### 4.2 多租户隔离

- **Company 级别**：所有业务表均包含 `companyId` 字段
- **中间件**：`TenantContextMiddleware` 从 JWT 提取 `companyId`、`userId`，存入 `TenantContext` (AsyncLocalStorage)
- **守卫**：`TenantGuard` 校验请求中的 `x-company-id` header
- **查询隔离**：`CrudService.applyCompanyScope()` 自动注入 `companyId` 过滤条件

---

## 5. 中间件与守卫链

```
请求 → Helmet(安全头) → CORS(白名单) → GlobalPrefix(/api)
     → ValidationPipe(whitelist+transform)
     → AllExceptionsFilter
     → LoggerMiddleware → TenantContextMiddleware
     → JwtAuthGuard → TenantGuard
     → Controller → Service
```

---

## 6. 基础设施

| 组件     | 本地 (docker-compose)    | CI (GitHub Actions)       | 生产                    |
| -------- | ------------------------ | ------------------------- | ----------------------- |
| 数据库   | postgres:15-alpine       | postgres:15-alpine        | PostgreSQL 15           |
| 缓存     | redis:7-alpine           | —                         | Redis 7                 |
| 对象存储 | minio:latest             | —                         | MinIO / S3              |
| 镜像仓库 | —                        | ghcr.io                   | ghcr.io                 |
| 部署     | `start.bat` / `stop.bat` | Docker Build + Push       | docker-compose.prod.yml |
