# 🏗️ 下一代 ERP 研发纪律与规范指南 (Engineering Standards)

## 一、 🚀 全局统一验证命令 (Quality Gates)
为降低每个开发者的心智负担，所有质量验证必须在**根目录**实现统一入口（基于 npm workspaces 或 Turborepo）。在提交代码前，必须保证以下命令 100% 跑通：

*   `npm run typecheck`: **最核心闸门**。执行全套 TypeScript 严格类型检查（前后端同步校验，不允许有任何 `any` 漏网之鱼）。
*   `npm run lint`: 执行 ESLint 规则检查并尝试自动修复。
*   `npm run format`: 统一代码风格（Prettier），消除因缩进/引号引起的无意义 Code Review。
*   `npm run test`: 执行单元测试与核心业务链路流转的集成测试。
*   `npm run build`: 生产环境跨端联合编译演练（Web + API + Desktop 联合测试）。
*   **🚨 终极核验**: `npm run validate` —— 串联执行 `format -> lint -> typecheck -> test -> build`。**CI/CD 流水线将依据此命令判断是否允许合并 PR！**

## 二、 🛡️ 严格的代码规范 (Lint / Formatter / Typecheck)

### 1. TypeScript 铁律 (`tsconfig.json`)
*   `"strict": true` 必须全局开启。
*   `"noImplicitAny": true`：**绝对禁止**隐式 `any`。对于尚未明确结构的第三方数据，强制使用 `unknown` 并搭配 Zod 进行运行时序列化校验。
*   `"strictNullChecks": true`：必须显式处理 `null` 和 `undefined`。

### 2. ESLint 强制约束 (`eslint.config.mjs`)
*   **禁止出现**：`@typescript-eslint/no-explicit-any` (Warning 改 Error，除非使用 `eslint-disable` 且附带详细理由)。
*   **禁止滥用感叹号**：`@typescript-eslint/no-non-null-assertion` (容易引发线上白屏)。
*   **未使用的变量/导入**：`no-unused-vars` / `unused-imports` (保存时必须自动清除)。
*   **依赖边界限制**：前端组件中**严禁**直接导入服务端库（如 `fs`, `prisma`）；UI 组件库 (`apps/web/src/components/core`) 中严禁耦合具体的业务数据请求，必须依靠 Props 传递或标准 Store。

### 3. Prettier 格式化标准
*   缩进：2 空格。
*   单引号为主（`singleQuote: true`）。
*   末尾逗号（`trailingComma: 'all'`，减少合并冲突）。
*   最大行宽 `printWidth: 100`。

## 三、 🚧 禁区声明：常见约束与开发红线

为防止引擎架构被破坏，制定以下“代码隔离”红线：

### ❌ 绝对禁区（DO NOT TOUCH）
1.  **生成的类型与客户端**：`apps/api/generated/prisma/` - 这是 Prisma 依据 `schema` 自动生成的，任何手动修改都会在下次 `prisma generate` 时被抹除。
2.  **ORM 迁移记录**：`apps/api/prisma/migrations/` - 仅由 `npx prisma migrate dev` 生成！**绝不可手动修改历史 migration 的 SQL 文件**，以免破坏线上生产环境数据库一致性。
3.  **构建输出与缓存**：`apps/web/.next/`, `apps/api/dist/`。

### ⚠️ 核心架构区（仅架构师/Core Team 授权修改）
*   `apps/api/src/core/crud/*`（通用网关引擎）
*   `apps/api/src/core/metadata/*`（系统元数据字典服务）
*   `apps/web/src/components/core/*`（前端动态视图渲染引擎 Engine）
> *业务开发人员的需求如果当前引擎不支持，必须提交 Issue 或 PR 给 Core Team 进行引擎升级，**严禁在具体业务页面写死特殊逻辑绕过引擎**！*

### ✅ 业务开发区（Feature Team 主要工作区）
*   针对新模型：在 `schema.prisma` 添加模型。
*   定义元数据：在 `ui-schema.ts` 或字典表中追加该模型的页面呈现/字段规则。
*   如有特殊生命周期需求（如审核通过扣减库存）：使用 NestJS `EventEmitter` 或向 `Resource Service` 注册 Hooks/Interceptor，而非重写整个 Controller。

## 四、 📝 Git 提交规范 (Commit Convention)

启用 `commitlint` 配合 `husky`，所有提交强制遵循 Angular 规范，便于自动生成 ChangeLog。

格式：`<type>(<scope>): <subject>`

**Type 示例：**
*   `feat`: 新功能（如添加库存看板引擎）
*   `fix`: 修复 Bug（如修复分页参数解析异常）
*   `refactor`: 重构（不影响外部 API 的核心逻辑变动）
*   `chore`: 日常事务（更新依赖、配置 lint）
*   `docs`: 文档变更

**Scope 示例：** (明确影响范围)
*   `api`: 后端相关
*   `web`: Web 前端相关
*   `core`: 引擎/基建变动（需尤为注重 Code Review）
*   `prisma`: 数据库模型变更

**💡 正确示例：**
*   `feat(api): 支持 /api/v1/resource 中 include 深度关联查询`
*   `fix(web): FormEngine 修复 DatePicker 默认值不回显的问题`
*   `chore(prisma): 新增 Material 实体及迁移脚本`

---
### 架构师的最后嘱托：
“千里之堤，毁于蚁穴。任何一次为了‘图快’而在视图组件中写死某个表的字段，或是为了绕过动态 CRUD 而手写特定的 SQL 接口，都是在系统里埋下一颗定时炸弹。**请团队始终保持把业务抽象为配置、让配置驱动引擎的哲学。**”