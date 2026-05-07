# OneERP 本地部署与业务能力测试手册

> **最后更新**: 2026-05-07
> **维护者**: Core Team
> **目标读者**: 新手开发者、QA、AI Agent

---

## 1. 环境准备

### 1.1 前置条件

- Node.js ≥ 18
- Docker & Docker Compose
- Git

### 1.2 克隆与安装

```bash
git clone https://github.com/cb8010d6/OneERP.git
cd OneERP
npm install
```

### 1.3 启动数据库

```bash
docker compose up -d
```

启动 PostgreSQL (5432)、Redis (6379)、MinIO (9000)。

### 1.4 初始化数据库

```bash
# 设置环境变量
set DATABASE_URL=postgresql://eip_user:eip_password@localhost:5432/eip_db

# 推送 schema
npm --prefix apps/api exec prisma -- db push --schema=./prisma/schema.prisma

# 生成 Prisma Client
npm --prefix apps/api exec prisma -- generate --schema=./prisma/schema.prisma
```

### 1.5 启动服务

```bash
# 终端 1：启动 API (端口 8000)
set DATABASE_URL=postgresql://eip_user:eip_password@localhost:5432/eip_db
npm --prefix apps/api run start:dev

# 终端 2：启动 Web (端口 3000)
npm --prefix apps/web run dev
```

---

## 2. 登录验证

### 2.1 注册新用户

```bash
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test1234","name":"测试用户"}'
```

**预期**: 返回 201，包含用户信息和 token。

### 2.2 浏览器登录

1. 访问 `http://localhost:3000/login`
2. 输入注册的邮箱和密码
3. **预期**: 登录成功，跳转到 dashboard

### 2.3 验证 Token

- 登录后浏览器应无 `Network Error`
- Dashboard 概览应显示统计数据（可能为空态）

---

## 3. 业务功能测试清单

### 3.1 销售订单流程

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 侧栏点击"销售打单" | 页面加载无报错 |
| 2 | 点击"新建/编辑" | 表单弹窗打开 |
| 3 | 填写订单信息并保存 | 创建成功，列表刷新 |
| 4 | 点击订单行 | 进入编辑模式 |
| 5 | 侧栏点击"订单管理" | 订单列表正常显示 |

### 3.2 采购订单流程

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 侧栏点击"采购订单" | 页面加载无 404 |
| 2 | 查看采购订单列表 | 列表正常显示（可能为空） |
| 3 | 新建采购订单 | 保存成功 |

### 3.3 库存管理

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 侧栏点击"生产与库存" | 页面加载无报错 |
| 2 | 查看库存列表 | 显示当前库存数据 |

### 3.4 财务管理

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 侧栏点击"财务管理" | 页面加载无报错 |
| 2 | 查看发票列表 | 显示发票数据 |

### 3.5 生产管理

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 侧栏点击"生产管理" | 页面加载无报错 |
| 2 | 查看工单列表 | 显示工单数据 |

### 3.6 系统设置

| 步骤 | 操作 | 预期 |
|------|------|------|
| 1 | 侧栏点击"系统设置" | 页面加载无 500 |
| 2 | "员工与账号" tab | 正常显示（可能为空） |
| 3 | "组织架构" tab | 正常显示（可能为空） |
| 4 | "系统与企业号" tab | 显示企业信息 |

---

## 4. AI 命令测试

### 4.1 命令面板

1. 按 `/` 键打开命令面板
2. 输入自然语言指令

### 4.2 测试用例

| 指令 | 预期 |
|------|------|
| "创建一个客户叫测试公司" | 生成草稿或直接创建 |
| "查看最近的订单" | 返回订单列表 |
| "应收欠款" | 显示应收账款统计 |

### 4.3 Chat2SQL 安全查询

| 查询 | 预期 |
|------|------|
| "本月订单按状态统计" | 返回分组统计结果 |
| "采购订单金额合计" | 返回聚合结果 |

**安全验证**: 以下查询应被拒绝或无结果
- 任何包含 DELETE/UPDATE/DROP 的"查询"
- 跨租户数据访问

---

## 5. 自动化测试

### 5.1 运行全部测试

```bash
# 设置环境变量
set DATABASE_URL=postgresql://eip_user:eip_password@localhost:5432/eip_db

# 运行所有测试
npm run test
```

### 5.2 分模块测试

```bash
# API 单元测试
npm --prefix apps/api run test

# Web 组件测试
npm --prefix apps/web run test
```

### 5.3 类型检查

```bash
npm run typecheck
```

### 5.4 Lint 检查

```bash
npm run lint
```

### 5.5 完整质量门禁

```bash
npm run validate
```

包含：prisma validate → generate → typecheck → lint → test → build

---

## 6. 常见问题排查

### 6.1 登录后 Network Error

- 检查 API 是否在 8000 端口运行
- 确认 Next.js proxy 配置正确（`next.config.ts` 中的 rewrite）

### 6.2 Dashboard 500 错误

- 检查 `DATABASE_URL` 是否正确
- 确认 Prisma schema 已 push
- 查看 API 终端日志

### 6.3 采购订单 404

- 确认 MetadataService 中已注册 `purchaseOrder` schema
- 检查路由是否为 `/dashboard/dynamic/purchaseOrder`

### 6.4 Settings 页面 500

- 确认 `department` 和 `userCompanyRole` metadata 字段与 Prisma schema 一致
- 检查 `createdAt` 字段是否存在于对应 Prisma 模型

---

**文档维护说明**: 每次新增业务模块时，应在本文档中补充对应的测试步骤。