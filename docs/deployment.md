# OneERP 部署指南

> 本文档面向 DevOps 工程师和项目总结构师，明确部署流程中的关键决策。

---

## 1. 部署模式：构建 + 自动部署

### 决策：CI/CD 全自动（构建镜像 → 推送 GHCR → SSH 部署服务器）

| 阶段 | 触发方式 | 说明 |
|------|---------|------|
| **构建** | push to `main` / 手动触发 | GitHub Actions 自动构建 Docker 镜像 |
| **推送** | 同上 | 镜像自动推送到 GitHub Container Registry (GHCR) |
| **部署** | 同上 | 通过 SSH 连接生产服务器，拉取新镜像并重启服务 |

**不采用"只构建镜像、手动部署"模式** — 已在 `deploy.yml` 中启用 SSH 自动部署。

### 流程图

```
git push main
    │
    ▼
┌─────────────┐   ┌─────────────┐
│  build-api  │   │  build-web  │    (并行)
│  构建+推送   │   │  构建+推送   │
└──────┬──────┘   └──────┬──────┘
       │                 │
       └────────┬────────┘
                ▼
         ┌─────────────┐
         │   deploy    │    SSH → 服务器
         │ pull + up   │
         └──────┬──────┘
                ▼
         ┌─────────────┐
         │  verify     │    健康检查
         └─────────────┘
```

---

## 2. GHCR 权限配置

### 2.1 镜像推送权限（CI 侧）

GitHub Actions 自动获取 `GITHUB_TOKEN`，无需手动配置 PAT。

```yaml
# deploy.yml 中已配置
permissions:
  contents: read
  packages: write    # 允许推送镜像到 ghcr.io
```

### 2.2 镜像拉取权限（服务器侧）

**私有仓库**需要在生产服务器上配置 GHCR 登录凭据：

```bash
# 方式 A: 使用 GitHub PAT（推荐）
# 1. 在 GitHub Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens
#    创建一个 token，权限: packages:read
# 2. 在服务器上登录:
echo "$GHCR_PAT" | docker login ghcr.io -u YOUR_USERNAME --password-stdin

# 方式 B: 使用 deploy key + GITHUB_TOKEN（仅限 GitHub Actions 内部使用）
# deploy.yml 中已通过 docker/login-action 自动处理
```

**公开仓库**无需额外配置，任何人均可拉取。

### 2.3 所需 Secrets & Variables

在 GitHub 仓库 Settings → Secrets and variables → Actions 中配置：

| 名称 | 类型 | 说明 |
|------|------|------|
| `DEPLOY_HOST` | Secret | 生产服务器 IP 或域名 |
| `DEPLOY_USER` | Secret | SSH 登录用户名 |
| `DEPLOY_SSH_KEY` | Secret | SSH 私钥（用于免密登录） |
| `APP_URL` | Variable | 应用访问地址（用于 environment URL 显示） |

---

## 3. 镜像标签 (Tag) 策略

### 3.1 标签规则

| 标签格式 | 生成时机 | 用途 |
|---------|---------|------|
| `latest` | 每次 main 分支 push | 默认部署版本 |
| `main` | 每次 main 分支 push | 分支标签 |
| `<7位commit SHA>` | 每次 push | **回滚标识**，如 `a1b2c3d` |

### 3.2 镜像全名格式

```
ghcr.io/<owner>/oneerp-api:<tag>
ghcr.io/<owner>/oneerp-web:<tag>
```

示例：
- `ghcr.io/myorg/oneerp-api:latest` — 最新版本
- `ghcr.io/myorg/oneerp-api:a1b2c3d` — 指定 commit 版本

### 3.3 如何指定标签部署

```bash
# 服务器端手动指定标签
IMAGE_TAG=a1b2c3d docker compose -f docker-compose.prod.yml up -d

# 或通过 GitHub Actions 手动触发时填写 image_tag 参数
```

---

## 4. 回滚策略

### 4.1 自动回滚（CI 健康检查失败）

`deploy.yml` 中的 `verify` 步骤会在部署后执行健康检查：
- 检查所有容器状态
- 调用 `/api/docs` 验证 API 可用性
- **如果健康检查失败，workflow 标记为失败**（但不会自动回滚旧版本）

### 4.2 手动回滚（推荐）

回滚操作通过 GitHub Actions 手动触发：

1. 打开 GitHub → Actions → Deploy workflow
2. 点击 "Run workflow"
3. 在 `image_tag` 输入框中填写要回滚的 commit SHA（如 `a1b2c3d`）
4. 点击 "Run workflow"

**服务器端紧急回滚**：

```bash
cd /opt/oneerp

# 查看历史部署的镜像标签
# (在 GitHub Actions 历史记录中找到上一个成功的 commit SHA)

# 回滚到指定版本
IMAGE_TAG=<上一个成功commit的SHA前7位> \
  docker compose -f docker-compose.prod.yml pull && \
  IMAGE_TAG=<上一个成功commit的SHA前7位> \
  docker compose -f docker-compose.prod.yml up -d --remove-orphans

# 验证
docker compose -f docker-compose.prod.yml ps
curl -s http://localhost:8000/api/docs | head -5
```

### 4.3 回滚注意事项

- **数据库迁移是单向的** — 如果新版本包含破坏性的 Prisma migration，回滚代码后数据库结构不会自动回退。重大变更前请确保已备份数据库。
- **备份命令**：
  ```bash
  docker exec oneerp_postgres pg_dump -U eip_user eip_db > backup_$(date +%Y%m%d_%H%M%S).sql
  ```

---

## 5. 环境变量完整性检查

### 5.1 `.env` 中必须设置的变量（无默认值，启动会失败）

| 变量 | 所属服务 | 说明 |
|------|---------|------|
| `POSTGRES_PASSWORD` | db, api | 数据库密码 |
| `JWT_SECRET` | api | JWT 签名密钥，务必使用强随机字符串 |
| `MINIO_SECRET_KEY` | minio, api | MinIO 对象存储密钥 |
| `IMAGE_OWNER` | api, web | GitHub 用户名或组织名（镜像地址前缀） |

### 5.2 `.env` 中可选的变量（有默认值）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `POSTGRES_USER` | `eip_user` | 数据库用户名 |
| `POSTGRES_DB` | `eip_db` | 数据库名称 |
| `DB_PORT` | `5432` | 数据库端口 |
| `REDIS_PORT` | `6379` | Redis 端口 |
| `REDIS_PASSWORD` | *(空)* | Redis 密码（建议设置） |
| `MINIO_ACCESS_KEY` | `minio_admin` | MinIO 用户名 |
| `MINIO_API_PORT` | `9000` | MinIO API 端口 |
| `MINIO_CONSOLE_PORT` | `9001` | MinIO 控制台端口 |
| `API_PORT` | `8000` | API 服务端口 |
| `WEB_PORT` | `3000` | Web 前端端口 |
| `HTTP_PORT` | `80` | Nginx HTTP 端口 |
| `HTTPS_PORT` | `443` | Nginx HTTPS 端口 |
| `REGISTRY` | `ghcr.io` | 镜像仓库地址 |
| `IMAGE_TAG` | `latest` | 镜像标签（回滚时指定 SHA） |
| `CORS_ORIGINS` | `http://localhost:3000` | CORS 白名单（生产环境务必修改） |
| `OPENAI_API_KEY` | *(空)* | OpenAI API Key（可选，启用 AI 功能） |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI 模型 |

### 5.3 生产环境 `.env` 最小配置模板

```bash
# ===== 必填 =====
POSTGRES_PASSWORD=<强密码>
JWT_SECRET=<64位随机字符串>
MINIO_SECRET_KEY=<强密码>
IMAGE_OWNER=<github用户名或组织名>

# ===== 强烈建议修改 =====
REDIS_PASSWORD=<强密码>
CORS_ORIGINS=https://your-domain.com

# ===== 可选 =====
# OPENAI_API_KEY=sk-xxx
```

### 5.4 已修复的环境变量问题

| 问题 | 修复前 | 修复后 |
|------|--------|--------|
| Web 变量名不匹配 | `NEXT_PUBLIC_API_URL` | `NEXT_PUBLIC_API_BASE_URL` (与 `apps/web/src/lib/api.ts` 一致) |
| Redis 健康检查不带密码 | `redis-cli ping` | `redis-cli -a $REDIS_PASSWORD ping \| grep PONG` |
| API 缺少 CORS 配置 | 未设置 | 新增 `CORS_ORIGINS` 环境变量 |
| IMAGE_OWNER 有无效默认值 | `${IMAGE_OWNER:-your-org}` | `${IMAGE_OWNER}`（强制要求配置） |
| 镜像标签硬编码 | `:latest` | `${IMAGE_TAG:-latest}`（支持回滚指定版本） |

---

## 6. 运维命令速查

```bash
# ---- 查看服务状态 ----
docker compose -f docker-compose.prod.yml ps

# ---- 查看日志 ----
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f web

# ---- 重启单个服务 ----
docker compose -f docker-compose.prod.yml restart api

# ---- 进入容器 ----
docker exec -it oneerp_api sh

# ---- 数据库备份 ----
docker exec oneerp_postgres pg_dump -U eip_user eip_db > backup_$(date +%Y%m%d_%H%M%S).sql

# ---- 数据库恢复 ----
cat backup_20240101_120000.sql | docker exec -i oneerp_postgres psql -U eip_user eip_db

# ---- 查看镜像历史 ----
docker images | grep oneerp

# ---- 清理无用镜像 ----
docker image prune -f