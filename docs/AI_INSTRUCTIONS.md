# AI Agent 开发与协作规范 (AI_INSTRUCTIONS)

欢迎阅读 Enterprise ERP 项目的 AI 协作规范。作为这个项目的接力 AI 开发者，你需要严格遵循本文档中描述的架构、规范和开发流程，模拟并且参考类似 `Odoo` 和 `ERPNext` 那样的大型企业级项目的规范。

## 1. 整体架构与项目结构

本系统以 Monorepo 形式构建（使用 npm workspaces / pnpm workspace），共有以下主要子应用：

- `apps/api/`: 后端主服务。使用 **NestJS** 结合 **Prisma ORM** + **PostgreSQL**。
- `apps/web/`: 后台与业务管理前端。使用 **Next.js** + **TailwindCSS** + **Shadcn UI**。
- `apps/mobile/`: 移动端 (React Native/Expo)。负责扫码、生产报工和现场查询。
- `apps/desktop/`: 桌面端包装应用 (Tauri)。

## 2. 后端开发规范 (NestJS + Prisma)

### 2.1 依赖与 ORM

- **数据流与模型化设计**: 参考 ERPNext 和 Odoo 的设计，数据库模型（Prisma schema）需尽可能包含完整的字段描述（如名称、状态、审计字段：`createdAt`/`updatedAt`/`createdBy_id`、多公司化隔离字段：`company_id`）。
- **Prisma Schema (存放于 `apps/api/prisma/schema.prisma`)**: 这里定义了业务模型。每当新增模型：
  1. 更新 `schema.prisma`。
  2. 运行 `npx prisma format` 和 `npx prisma db push` 或产生迁移。
  3. 运行 `npx prisma generate`。

### 2.2 模块化服务层级

每一个业务领域都是一个独立的 Nest 模块。例如：`src/inventory/`。

- **Controller 层**: 全量支持 Swagger，严格对入参做 DTO 校验（`class-validator`、`class-transformer`）。
- **Service 层**:
  - 不要把业务逻辑堆砌在 Controller 中。
  - 对于所有的状态流转（例如由新建->确认的状态转变），必须在这里抛出业务异常信息，且注意事务一致性。
- **跨模块调用**: 涉及到关联计算，通过依赖注入，互相隔离解耦。

### 2.3 异常与响应处理

必须返回标准的 API 响应格式，或者使用统一的拦截器格式化成：

```json
{
  "code": 200,
  "message": "success",
  "data": { ... }
}
```

## 3. 前端 Web 端规范 (Next.js)

### 3.1 目录组织与组件

- **路由层**: App Router (`apps/web/src/app`) 组织所有页面逻辑。
- **状态维护**: 使用 React Zustand (`src/store`) 进行复杂的业务状态保持。对于普通的服务端请求抓取，必须采用 SWR 或 React Query 管理缓存。
- **UI 组件 (`src/components/ui/`)**: Shadcn UI 组件目录。不要在这里定义业务逻辑。
- **业务视图 (`src/components/views/` 或 `features/`)**: 具体某个领域的组件，例如 `InventoryTable`。

## 4. ERP 核心系统机制（必须实现的设计模式与思维）

想要设计好这些模块必须站在 ERP 的视角：

- **公司多租户 (Multi-Company)**：所有重要的数据实体都必须包含 `companyId` 字段，以实现隔离；并在全局守卫中鉴别出当前用户的公司并在 Prisma 扩展或查询层统一注入 `where: { companyId }`。
- **状态机 (State Machine / Odoo 的 Status)**：每个业务单据（报价单、采购单、发票、生产订单等）都有生命周期枚举（如 `DRAFT, SUBMITTED, APPROVED, CANCELLED, DONE`）。不能随便进行状态跳转。
- **审核流 (Workflows)**：敏感操作需留存操作日志。
- **版本控制与追踪 (Traceability)**：库存的任何变更（无论出入或盘盈亏）都不能直接改数字，必须通过 "Stock Move"（库存移动）操作表记录。
- **会计核心 (Double-entry)**：财务数据只能通过新增复式记账凭证（Journal Entries）修改其汇总数，切忌直接在余额表改数字。

## 5. Next AI 任务执行指南

当你（下一个 AI Agent）接手本工程开发时：

1. 请先检查 `TODO.md` 中目前的未完成事项。
2. 任何涉及到新表、新字段，首先确定 **Prisma Schema** 的设计。
3. 任何涉及到前端界面的，尽量复用 Tailwind 和 Shadcn 的标准样式。
4. 提供代码后，确保先阅读错误再修改。如果有类型错误，仔细使用终端进行 `npx tsc --noEmit` 校验，修改直到终端返回无错误再汇报。
5. **请在一次性改写或重构复杂的服务层逻辑时，充分重构和验证。**
