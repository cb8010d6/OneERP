# Contributing Guide

感谢你为 Enterprise ERP 做贡献。

## 1. 分支约定

- `main`: 生产分支
- `develop`: 集成分支
- `agent/backend/<topic>`: 后端任务分支
- `agent/frontend/<topic>`: 前端任务分支
- `agent/db/<topic>`: 数据库任务分支

## 2. 开发环境准备

建议使用 Node.js 22（与 CI 一致）。本地源码开发还需要 Docker Desktop + Compose V2（Windows），或 Docker Engine + Compose 插件（Linux）。第一次体验产品时，可先按 [README 快速体验](./README.md#快速体验docker) 启动完整容器版。

仓库的根目录、API 和 Web 使用独立的 npm lockfile；从仓库根目录分别安装：

```bash
npm ci
npm ci --prefix apps/api
npm ci --prefix apps/web
```

启动供热更新 API/Web 使用的本地依赖服务：

```bash
docker compose up -d
docker compose ps
docker compose exec db pg_isready -U eip_user -d eip_db
docker compose exec redis redis-cli ping
```

等待 Postgres 显示 `accepting connections`、Redis 返回 `PONG`。确认 `docker compose ps` 中 MinIO 为 `Up`；若服务没有就绪，查看日志：

```bash
docker compose logs -f db redis minio
```

`docker-compose.yml` 中的数据库和 MinIO 凭据仅供本地开发使用；不要拿它们部署或连接真实业务数据。API 进程不会自动读取根目录 `.env`，所以在运行 Prisma/API 的同一个终端设置以下环境变量。以下示例会创建本地管理员并初始化公司、角色和默认账套。密码由你在本机输入，至少 12 个字符；请保存到密码管理器。Windows PowerShell（从仓库根目录运行）：

```powershell
$env:DATABASE_URL = 'postgresql://eip_user:eip_password@127.0.0.1:5432/eip_db'
$env:JWT_SECRET = 'local-dev-only-secret'
$env:MINIO_ACCESS_KEY = 'minio_admin'
$env:MINIO_SECRET_KEY = 'minio_password'
$env:MINIO_ENDPOINT = '127.0.0.1'
$env:MINIO_PORT = '9000'
$env:MINIO_USE_SSL = 'false'
$env:REDIS_HOST = '127.0.0.1'
$env:REDIS_PORT = '16379'
$env:CORS_ORIGINS = 'http://localhost:3000'
$env:INIT_ADMIN_EMAIL = 'admin@oneerp.local'
$env:INIT_COMPANY_NAME = 'OneERP Local'
$securePassword = Read-Host 'Set a local admin password (12+ characters)' -AsSecureString
$credential = [System.Net.NetworkCredential]::new('', $securePassword)
$env:INIT_ADMIN_PASSWORD = $credential.Password
Set-Location apps/api
npx prisma generate
npx prisma migrate deploy
npm run init:prod
npm run start:dev
```

Linux Bash（从仓库根目录运行）：

```bash
export DATABASE_URL='postgresql://eip_user:eip_password@127.0.0.1:5432/eip_db'
export JWT_SECRET='local-dev-only-secret'
export MINIO_ACCESS_KEY='minio_admin'
export MINIO_SECRET_KEY='minio_password'
export MINIO_ENDPOINT='127.0.0.1'
export MINIO_PORT='9000'
export MINIO_USE_SSL='false'
export REDIS_HOST='127.0.0.1'
export REDIS_PORT='16379'
export CORS_ORIGINS='http://localhost:3000'
export INIT_ADMIN_EMAIL='admin@oneerp.local'
export INIT_COMPANY_NAME='OneERP Local'
read -r -s -p 'Set a local admin password (12+ characters): ' INIT_ADMIN_PASSWORD
printf '\n'
export INIT_ADMIN_PASSWORD
cd apps/api
npx prisma generate
npx prisma migrate deploy
npm run init:prod
npm run start:dev
```

`npm run init:prod` is an upsert. Run it once for a new local database; if you run it again for the same email, it replaces that account's password with the current `INIT_ADMIN_PASSWORD` value.

在第二个终端从仓库根目录启动 Web。`API_BASE_URL` 指向宿主机 API，`NEXT_PUBLIC_API_BASE_URL` 让浏览器通过 Next.js 本地代理访问 API。

Windows PowerShell：

```powershell
$env:API_BASE_URL = 'http://127.0.0.1:8000'
$env:NEXT_PUBLIC_API_BASE_URL = '/api/proxy'
Set-Location apps/web
npm run dev
```

Linux：

```bash
cd apps/web
API_BASE_URL='http://127.0.0.1:8000' NEXT_PUBLIC_API_BASE_URL='/api/proxy' npm run dev
```

访问 Web：<http://localhost:3000>；API 文档：<http://localhost:8000/api/docs>。本地依赖安装完成后，可在根目录运行 `npm run validate`。

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
