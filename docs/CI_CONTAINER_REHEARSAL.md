# 当前提交容器交付演练 / Current-head container rehearsal

`scripts/ci/container-rehearsal.mjs` 在 GitHub Actions 的一次性 Linux runner 上，使用当前干净 checkout 的现有 Dockerfile 构建 API `production`、API `builder`（migration/init）及 Web `production` 镜像。它不推送镜像、不调用 SSH、不部署生产、不合并分支。

运行入口（只在一次性 GitHub Actions runner 执行）：

```bash
CI=true GITHUB_ACTIONS=true ONEERP_CONTAINER_REHEARSAL=1 \
  CONTAINER_REHEARSAL_REPORT="$RUNNER_TEMP/container-rehearsal-report.json" \
  node scripts/ci/container-rehearsal.mjs
```

工作流应 checkout PR 的精确 head，授予 `contents: read`，设置 60 分钟 job 超时，并把该 job 纳入最终 `validate` 必须成功的依赖。脚本不需要主机 npm 安装；HTTP 验收脚本只使用 Node 22 内置 API。

## 实际验证边界

1. 记录 `git rev-parse HEAD`、tree 和实际本地 image ID；开始与结束都要求 source checkout 干净。
2. 顺序构建三个应用镜像以及现有 `scripts/ci/minio.Dockerfile` 的 CI 专用固定源码 MinIO 镜像。MinIO **不是生产镜像替代方案，未解决 #35**。
3. 用随机 `oneerp-ci-<24 hex>` 项目创建 PostgreSQL、Redis、MinIO 私有网络和卷。仅 API/Web 使用随机回环端口。依赖 readiness 通过后，实际执行生产 migration/init 镜像。
4. API/Web 使用生产镜像启动；验证运行镜像 ID，读取 Web `/login` 及其引用的静态资源，验证 Web API proxy health 和登录。库存贸易 13 步与制造 12 步通过真实 HTTP 容器边界执行。
5. 调用 `recovery-rehearsal.mjs`：备份合成 PostgreSQL 和上传对象，使用同一组实际运行 image ID 在独立空卷中恢复；比较业务行、文件身份和下载字节。恢复不重新迁移或初始化。
6. 默认删除本次随机项目的容器、网络和卷，删除临时凭据/原始验收报告；仅输出允许字段构成的 JSON 证据。清理失败也使门禁失败。

脚本拒绝缺失显式 CI 开关、非默认 Docker host/context、非本地 runner socket、脏 checkout 及非回环发布端口。随机密码通过 GitHub mask 注册，临时 `.env` 权限为 `0600`。不要上传临时目录、Docker config/inspect 全文、容器日志、SQL、归档、signed URL 或 token。工作流只上传 `container-rehearsal-report.json`。

## 资源与证据解释

标准 Ubuntu runner 顺序构建，运行时每个 stack 内存上限合计约 3 GiB（一次性 migration 上限 1 GiB；恢复阶段最多两个 stack）。构建、镜像和 BuildKit 缓存需要额外内存/磁盘；预留约 10–15 GB 磁盘作为初始预算，实际消耗以 runner 为准。每个命令有超时，job 的 60 分钟限额是最终上界。没有全局 prune、共享卷删除或镜像发布；runner 销毁负责最终镜像/缓存回收。

本地无 Docker daemon 时，`node --test scripts/ci/container-rehearsal.test.mjs` 只证明命令编排、防误用、清理和证据脱敏；它不证明镜像能构建或服务能启动。只有精确提交的 GitHub 容器 job 通过后，才能报告该提交的真实构建、25 步 HTTP 与合成恢复已通过。证据 JSON 中的本地 image ID 是本次构建身份，不是可供生产拉取的 registry digest。

该结果仍不代替目标生产环境的 MinIO 分发治理、TLS/唯一凭据、异地备份、生产 RPO/RTO、真实数据与角色验收、库存/财务/运维签字。生产批准继续使用 `PRODUCTION_READINESS.md`、`HA_LITE_RUNBOOK.md` 与 `GO_LIVE_CHECKLIST.md`。
