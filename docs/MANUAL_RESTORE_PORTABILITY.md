# 手动恢复命令与验证边界 / Manual restore portability

手动恢复会写入选定 Compose 环境。操作前停止业务写入，确认目标环境和可信备份，并遵循 `HA_LITE_RUNBOOK.md` 的数据回滚流程。此修复不代表真实生产恢复已通过，也不关闭 issue #35 的外部上线门禁。

```sh
COMPOSE_FILE=docker-compose.ha-lite.yml sh scripts/restore.sh /path/to/backup
```

```powershell
.\scripts\restore.ps1 -BackupDir C:\backups\selected -ComposeFile docker-compose.ha-lite.yml
```

两个脚本仍默认使用 `docker-compose.easy.yml`，要求 `postgres.sql`，并仅在存在 `minio-data.tgz` 时恢复 MinIO。MinIO 使用与备份/演练一致的固定摘要 Alpine helper，不要求 MinIO 镜像包含 `tar`。Linux 使用二进制标准输入，PowerShell 使用只读备份目录挂载；PowerShell SQL 文件通过 Compose `cp` 原样复制，避免文本管道改变 UTF-8 内容。

存在 MinIO 归档时，脚本先确认唯一 MinIO 容器，并通过 helper 的 `tar tzf` 检查归档可读，再执行 SQL。此检查不是不可信归档的安全沙箱，也不是目标卷可写或完整恢复成功的证明。helper 可通过 Linux `BACKUP_HELPER_IMAGE`、PowerShell `-BackupHelperImage` 或 `ONEERP_BACKUP_HELPER_IMAGE` 覆盖；运维负责验证替代镜像。

SQL 使用 `ON_ERROR_STOP=1`，任一恢复命令失败都会阻止成功提示和后续恢复步骤。恢复不是跨 PostgreSQL/MinIO 的原子事务；中途失败可能留下部分已恢复数据，必须保持业务写入停止并由恢复负责人处理。PowerShell 使用唯一临时 SQL 路径，并在失败时尝试清理。

## Mocked verification

```sh
node --test scripts/restore.test.mjs
```

测试通过隔离 PATH 中的假 Docker CLI 检查命令顺序、Compose/helper 配置、二进制归档和 UTF-8 SQL 传递、SQL 错误停止参数、缺失/多个容器，以及失败传播。它们不会访问 Docker daemon，不执行真实 SQL 或真实归档提取，不证明生产恢复成功。PowerShell 用例在 `pwsh` 可用时执行，否则显式跳过；根目录 `npm test` 自动包含该文件。
