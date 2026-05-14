# OneERP 快速部署 / Quickstart Deployment

本文档以中文为主，英文作为辅助说明。它面向单机内测、试运行和生产演练，使用 Docker Compose 启动 PostgreSQL、Redis、MinIO、API、Web、迁移和生产初始化。

For bilingual teams: Chinese is the primary instruction; English labels clarify the commands and checkpoints.

真实库存或财务试生产时，先跑通本文档，再切换到 [`docs/HA_LITE_RUNBOOK.md`](./HA_LITE_RUNBOOK.md) 和 `docker-compose.ha-lite.yml`。

## 前置条件 / Prerequisites

- Windows 使用 Docker Desktop；Linux 使用 Docker Engine + Compose。
- 至少 4 CPU、8 GB RAM、30 GB 可用磁盘。
- 如果使用真实业务数据，必须准备应用服务器之外的备份位置。

## 一条命令启动 / One Command Start

Windows PowerShell:

```powershell
.\scripts\quickstart.ps1 -Rebuild
```

Linux/macOS:

```bash
sh scripts/quickstart.sh --rebuild
```

如果 `.env` 不存在，脚本会自动创建并生成本地密钥。

默认地址 / Default URLs:

- Web: http://localhost:3000
- API docs: http://localhost:8000/api/docs
- MinIO console: http://localhost:9001

默认管理员 / Default admin:

- Email: `admin@oneerp.local`
- Password: 查看 `.env` 中的 `INIT_ADMIN_PASSWORD`

首次登录后必须修改管理员密码。

## 日常操作 / Daily Operations

启动 / Start:

```bash
docker compose -f docker-compose.easy.yml up -d
```

停止 / Stop:

```bash
docker compose -f docker-compose.easy.yml down
```

状态 / Status:

```bash
docker compose -f docker-compose.easy.yml ps
```

日志 / Logs:

```bash
docker compose -f docker-compose.easy.yml logs -f api web
```

拉取新代码后升级 / Upgrade after pulling new code:

```bash
docker compose -f docker-compose.easy.yml up -d --build
```

`migrate` 服务会在 API 启动前执行 `prisma migrate deploy` 和幂等生产初始化。

## 备份 / Backup

Windows:

```powershell
.\scripts\backup.ps1
```

Linux/macOS:

```bash
sh scripts/backup.sh
```

备份输出到 `backups/YYYYMMDD-HHMMSS/`，包含：

- `postgres.sql`
- `minio-data.tgz`
- `.env.copy`

使用真实业务数据时，必须把备份移动或复制到应用服务器之外。

## 恢复 / Restore

恢复前必须停止写入流量。

Windows:

```powershell
.\scripts\restore.ps1 -BackupDir .\backups\YYYYMMDD-HHMMSS
```

HA-lite 环境使用：

```powershell
.\scripts\restore.ps1 -BackupDir .\backups\YYYYMMDD-HHMMSS -ComposeFile docker-compose.ha-lite.yml
```

Linux/macOS:

```bash
sh scripts/restore.sh backups/YYYYMMDD-HHMMSS
```

## 互联网部署注意事项 / Internet Deployment Notes

公网或跨办公区访问时：

1. 在 Web/API 前放置反向代理，例如 Caddy、Nginx 或云负载均衡。
2. 启用 HTTPS。
3. 将 `CORS_ORIGINS` 设置为真实 Web 域名。
4. 如果 Web 和 API 使用同一个域名，保留 `NEXT_PUBLIC_API_BASE_URL=/api/proxy`。
5. `.env` 必须使用强密钥。
6. 不要把 PostgreSQL、Redis、MinIO API 端口暴露到公网。

## 生产就绪门禁 / Production Readiness Gate

使用真实库存或财务数据前，必须完成：

- [`docs/PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md)
- [`docs/GO_LIVE_CHECKLIST.md`](./GO_LIVE_CHECKLIST.md)

HA-lite 最小命令 / Minimum HA-lite commands:

```powershell
docker compose -f docker-compose.ha-lite.yml up -d --build
.\scripts\deploy-check.ps1
.\scripts\prod-smoke.ps1
.\scripts\staff-permission-smoke.ps1
.\scripts\business-acceptance.ps1
.\scripts\audit-prod-config.ps1
.\scripts\backup.ps1 -ComposeFile docker-compose.ha-lite.yml
.\scripts\restore-drill.ps1
```
