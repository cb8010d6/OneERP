# Contributing Guide

感谢你为 Enterprise ERP 做贡献。

## 1. 分支约定

- `main`: 生产分支
- `develop`: 集成分支
- `agent/backend/<topic>`: 后端任务分支
- `agent/frontend/<topic>`: 前端任务分支
- `agent/db/<topic>`: 数据库任务分支

## 2. 开发前准备

```bash
npm install
docker compose up -d
```

后端初始化:

```bash
cd apps/api
npx prisma generate
npx prisma migrate dev --name init
npm run start:dev
```

前端启动:

```bash
cd apps/web
npm run dev
```

## 3. 提交规范

项目使用 Conventional Commits，格式如下:

```text
<type>(<scope>): <subject>
```

例子:

```text
feat(api): add finance dlq retry endpoint
fix(web): fix dynamic form date field parsing
chore(db): add migration for account constraints
```

## 4. 代码规范

1. 遵守 `docs/architecture/STANDARDS.md`
2. 优先复用核心引擎，不要在业务页面硬编码重复逻辑
3. 涉及数据库模型改动，必须附迁移说明
4. 接口变更必须更新 Swagger 注解和对应 DTO

## 5. Pull Request 检查清单

- [ ] 代码可读，命名清晰
- [ ] 通过本地 lint/build
- [ ] 涉及 UI 改动时附截图
- [ ] 涉及数据库改动时附迁移和回滚说明
- [ ] 描述中写明影响范围

## 6. 安全与数据

1. 不提交任何 `.env` 与密钥。
2. 不提交本地构建产物和缓存。
3. 不在日志中打印敏感字段（token、密码、手机号、税号）。

欢迎提交 Issue 和 PR，感谢你的投入。
