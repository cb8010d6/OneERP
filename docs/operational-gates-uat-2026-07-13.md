# 受控 UAT 运维门禁记录

日期：2026-07-13（Asia/Shanghai）
运行时标签：`uat-eb97174`
运维脚本提交：`c952e42`
Compose project：`oneerp_test`

## 范围

- 在服务器现有精确镜像上执行部署检查、生产冒烟、员工权限验收和完整业务验收。
- 创建 PostgreSQL 与 MinIO 即时备份，并在独立 Compose project 中执行恢复演练。
- 当前服务器为 2 GB 受控 UAT；所有结果只证明该环境的自动化门禁，不替代 HTTPS、异地备份、真实数据验收和人工签字。

## 门禁结果

- `deploy-check`：Docker、Compose 配置、环境文件、强密钥、服务状态、API 健康和 Web 根路径全部通过，`failed=0`。
- `prod-smoke`：登录页、Dashboard、管理员登录、统计、订单、动态元数据/资源、库存台账和发票查询全部通过，`failed=0`。
- `staff-permission-smoke`：13 个步骤全部通过；Readonly 员工可读订单和 AI tools，但用户创建、库存过账、工作流流转、部门创建、文件上传及 AI 写操作均返回 403。
- `business-acceptance`：11 个步骤全部通过；采购入库后库存为 10，库存不足发货被拒绝且数量不变，正常销售发货后库存为 6，销售发票生成借贷各 452 的凭证，最终试算平衡借贷各 3636、差额 0。

服务器报告：

- `uat-reports/staff-permission-smoke-eb97174.json`
- `uat-reports/business-acceptance-eb97174.json`
- `uat-reports/restore-drill-eb97174-post-rotation.json`
- `uat-reports/restore-drill-c952e42.json`

## 备份与恢复改进

- `deploy-check.sh` 的 `docker compose config` 改为静默校验，避免展开的环境变量进入日志。
- `backup.sh` 使用 `umask 077`，先写 `.incomplete-*` 临时目录，只有 PostgreSQL、MinIO 和清单全部成功后才原子改名。
- MinIO 镜像不含 `tar`；备份和恢复改为使用固定 SHA-256 digest 的一次性 `alpine:3.20` helper 挂载同一数据卷，不修改业务镜像。
- `restore-drill.sh` 支持可选 Compose override 和独立端口，默认使用 `18001/13001`，不会占用当前 UAT 的 `18000/13000`。
- PostgreSQL dump 不携带源角色所有权或授权；恢复演练会为临时 PostgreSQL、JWT 和 MinIO 生成独立随机密钥，不复用 UAT 基础设施密钥。
- 恢复顺序固定为：基础服务健康 → PostgreSQL/MinIO 恢复 → 核心数据校验 → migration → API 健康与管理员登录。
- 新增最多 120 秒的基础服务/API 健康等待，并把实际 RPO 年龄和 RTO 耗时写入报告。

## 最终恢复证据

- 最新复验备份：`backups/20260713-130009`，目录权限 `0700`，文件由 `umask 077` 创建，SQL 中无 `OWNER TO`、`GRANT` 或 `REVOKE`。
- 隔离项目：`oneerp_drill_c952e42`；演练后已自动执行 `down -v`，不保留临时容器、卷或演练环境文件。
- PostgreSQL 恢复、MinIO 恢复、公司、活跃用户、默认税码、默认总账日记账、API 健康和管理员登录全部通过。
- RPO 数据年龄：2 分钟，目标不超过 15 分钟。
- RTO 演练耗时：90 秒，目标不超过 60 分钟。

## Windows 脚本等价验证

- `backup.ps1` 与 Linux 脚本统一为临时目录原子发布、固定摘要 MinIO helper，并使用 `pg_dump --no-owner --no-privileges`，避免源数据库角色阻断跨项目恢复。
- `restore-drill.ps1` 已补齐 Compose override、独立端口、先恢复后迁移、API 健康轮询、RPO/RTO 判定和失败清理；Windows PowerShell 5.1 的随机数生成路径也完成兼容修复。
- 本地使用当前 39 个迁移初始化一次性合成数据栈，再通过 Windows PowerShell 执行完整 Docker 备份和独立恢复。11 项检查全部通过，RPO 数据年龄 5 分钟，RTO 26 秒。
- 演练结束后临时容器、卷、环境文件、备份副本和构建镜像均已删除。该证据验证跨平台运维脚本，不替代服务器上的受控 UAT 证据。

## 安全处置

- 旧版部署检查曾把 Compose 展开的敏感环境值带入受控检查日志；脚本已修复为静默输出。
- UAT 的数据库密码、JWT、MinIO 密钥和管理员密码均已在服务器端无回显轮换，并通过新凭据登录、部署检查和生产冒烟。
- 轮换前的两个备份及全部 `.env.before-*` 已删除；只保留轮换后且通过恢复演练的备份。
- 当前 `.env` 权限为 `0600`。

## 边界

- 当前证据不包含异地备份、HTTPS 外部链路、真实业务负责人签字或生产数据验收。
- 当前状态仍为受控 UAT，不代表生产就绪。
