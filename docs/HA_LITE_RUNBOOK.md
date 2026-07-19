# OneERP HA-lite 运维手册 / HA-lite Runbook

本文档以中文为主，英文作为辅助说明，供双语团队交接使用。
This document is Chinese-first, with English notes for bilingual operations.

## 适用范围 / Scope

- 单台服务器运行 Web、API、PostgreSQL、Redis 和 MinIO。
- PostgreSQL 与 MinIO 通过定时备份和恢复演练保护。
- 默认恢复目标：RPO 15 分钟，RTO 1 小时。
- `docker-compose.ha-lite.yml` 只暴露 Web/API 端口，数据库、Redis、MinIO 仅在 Docker 网络内访问。

这不是多活高可用，也没有自动故障切换。如果主机损坏，需要在另一台主机上用最近备份恢复。
This is not active-active HA. Recover on another host from the latest backup if the server is lost.

## 首次部署 / First Deployment

1. 将 `.env.quickstart` 复制为 `.env`。
2. 把所有 `CHANGE_ME` 替换为生产唯一强密钥。
3. 将 `CORS_ORIGINS` 设置为真实 Web 访问域名。
4. 启动 HA-lite 服务：

```powershell
docker compose -f docker-compose.ha-lite.yml up -d --build
```

5. 执行部署检查和生产配置审计：

```powershell
.\scripts\deploy-check.ps1
.\scripts\prod-smoke.ps1
.\scripts\staff-permission-smoke.ps1
.\scripts\business-acceptance.ps1
.\scripts\audit-prod-config.ps1
```

6. 首次登录后立即修改初始管理员密码，并记录运维负责人。

## 日常操作 / Daily Operations

启动 / Start:

```bash
docker compose -f docker-compose.ha-lite.yml up -d
```

查看状态 / Status:

```bash
docker compose -f docker-compose.ha-lite.yml ps
```

查看日志 / Logs:

```bash
docker compose -f docker-compose.ha-lite.yml logs -f api web
```

停止 / Stop:

```bash
docker compose -f docker-compose.ha-lite.yml down
```

## 备份 / Backup

默认策略文件：`ops/backup-policy.example.json`。

- PostgreSQL 备份间隔：15 分钟。
- MinIO 备份目标间隔：60 分钟。
- 本地保留：14 天。
- 异地备份目录：`offsiteDir`，为空时不复制。

手动备份 / Manual backup:

```powershell
.\scripts\backup.ps1 -ComposeFile docker-compose.ha-lite.yml
```

Windows 备份先写入 `.incomplete-*` 临时目录，PostgreSQL、MinIO、可选加密和清单全部成功后才原子发布。SQL 备份不携带源数据库角色所有权或授权，可恢复到使用不同 PostgreSQL 用户的独立环境。MinIO 归档由固定摘要的临时 helper 镜像完成，不依赖 MinIO 镜像内置 `tar`。

安装 Windows 定时备份 / Install Windows scheduled backup:

```powershell
.\scripts\install-backup-schedule.ps1
```

安装 Linux 定时备份 / Install Linux cron backup:

```bash
POLICY_FILE=ops/backup-policy.example.json COMPOSE_FILE=docker-compose.ha-lite.yml sh scripts/install-backup-schedule.sh
```

使用真实库存或财务数据时，备份必须复制到应用服务器之外的位置。
When real business data is used, backups must be copied off the application server.

## 恢复演练 / Restore Drill

首次备份后、每次重要部署变更后，都要执行恢复演练：

```powershell
.\scripts\restore-drill.ps1
```

演练脚本会创建临时 Docker Compose project，默认使用 API/Web 端口 `18001/13001`，恢复 PostgreSQL 和 MinIO，校验核心数据，调用 `/api/health`，在凭据可用时尝试管理员登录，输出 `restore-drill-report.json`，并默认删除临时 project。PostgreSQL、JWT 和 MinIO 的运行密钥会在临时环境中重新随机生成，不复用备份中的基础设施密钥；管理员凭据仍来自备份环境，用于验证恢复后的真实账号。

需要叠加资源限制或避开端口时：

```powershell
.\scripts\restore-drill.ps1 `
  -ComposeFile docker-compose.prod.yml `
  -ComposeOverrideFile docker-compose.test-2gb.yml `
  -DrillApiPort 18002 `
  -DrillWebPort 13002
```

通过标准 / Passing criteria:

- `restore-drill-report.json` 中 `status` 为 `passed`。
- 演练耗时少于 3600 秒。
- 业务时间内，最近一次成功备份不超过 15 分钟。

## 升级 / Upgrade

1. 确认已经完成新备份。
2. 记录当前 Git commit：

```bash
git rev-parse HEAD
```

3. 拉取目标版本并重建：

```bash
docker compose -f docker-compose.ha-lite.yml up -d --build
```

4. 检查服务状态：

```bash
docker compose -f docker-compose.ha-lite.yml ps
```

5. 执行部署检查、业务冒烟测试、员工权限验收和真实业务数据验收：`scripts/deploy-check.*`、`scripts/prod-smoke.*`、`scripts/staff-permission-smoke.*`、`scripts/business-acceptance.*`。

## 回滚 / Rollback

应用回滚 / Application rollback:

1. 切回上一个确认可用的 Git commit。
2. 使用 `docker-compose.ha-lite.yml` 重建服务。
3. 执行 `scripts/deploy-check.*` 和 `scripts/prod-smoke.*`。
4. 对真实库存/财务环境，再执行 `scripts/business-acceptance.*` 并复核报告。

数据回滚 / Data rollback:

1. 停止写入流量。
2. 使用 `scripts/restore.*` 恢复 PostgreSQL 和 MinIO；HA-lite 环境使用 `-ComposeFile docker-compose.ha-lite.yml`。
3. 使用同一个备份在临时 project 中执行恢复演练。
4. 财务和库存负责人确认恢复数据后，再恢复对外服务。

## 故障处理清单 / Incident Checklist

- Web 不可用：检查 `web`、`api` 健康状态和容器日志。
- API 不可用：检查 `/api/health`、`api` 日志、DB 健康状态、Redis 健康状态。
- DB 异常：停止写入；条件允许时先复制卷文件；再用最近备份在另一台主机恢复。
- 磁盘压力：停止非必要服务，转移备份，扩容磁盘，确认 PostgreSQL 有可用空间后再启动。
- MinIO 异常：用最近的 `minio-data.tgz` 恢复，并在 Web 中验证文件上传和下载。
