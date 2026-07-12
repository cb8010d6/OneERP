# 受控工程文档 UAT

日期：2026-07-12（Asia/Shanghai）
部署标签：`uat-1bf81bc`
分支：`refactor/remaining-tasks`

## 范围

- 工程文档主档关联产品和销售订单。
- 文件真实上传到 MinIO，并在 `FileRecord` 保存 SHA-256。
- 工程版本保存独立文件关系和校验值，已发布二进制不可覆盖。
- 状态链为 `DRAFT -> PENDING_REVIEW -> PENDING_APPROVAL -> RELEASED`。
- 设计、校审、批准使用三个独立角色和用户，业务服务再次校验人员不能重合。
- 发布新版本时旧发布版进入 `OBSOLETE`，历史文件和审批人继续保留。
- `/dashboard/files` 已由通用 CRUD 占位页替换为工程文档工作台，支持上传、关联、版本时间线、校审意见、发布和安全下载。
- 生产工单创建时必须选择适用的当前已发布工程版本，工单、版本固定记录和审计日志在同一事务内写入。
- 工单工作台默认勾选订单适用的已发布版本，并在工单卡片展示固定的文档编号和版本号。
- 存在受影响在制工单时禁止直接发布新版，必须创建工程变更单并覆盖全部受影响工单。
- ECO 对每张在制工单明确记录继续旧版、切换新版或报废返工；批准时重新检查影响集合并在单一事务内应用版本和工单处置。

## 自动验收

在远程 `oneerp_test` UAT 环境的 Compose 内网执行 `scripts/engineering-document-acceptance.mjs`：

```text
documentNo = ED-BAPRODMRED438FIW-000003
revision = R02
status = RELEASED
checksumVerified = true
workOrderNo = WO-20260712-027082
pinnedRevisionVerified = true
directReleaseBlocked = true
ecoNo = ECO-2026-000001
ecoApplied = true
actorsDistinct = true
temporaryUsersDisabled = true
passed = true
```

验收脚本执行以下真实操作：

1. 通过管理员 API 创建工程设计、工程校审、工程批准三个临时账号。
2. 设计账号上传 PDF 并创建关联产品、销售订单的工程文档 R01。
3. 设计账号提交校审。
4. 校审账号填写意见并校审通过。
5. 批准账号批准发布。
6. 重新查询文档，验证发布版本 ID、状态和 SHA-256 与上传结果一致。
7. 使用 R01 创建生产工单，再次查询工单并验证固定版本 ID 未丢失。
8. 上传并校审 R02；验证存在受影响在制工单时直接发布返回冲突。
9. 创建覆盖受影响工单的 ECO，选择切换新版并由独立批准人批准。
10. 验证 R01 已作废、R02 已发布、工单固定版本已切换到 R02。
11. 自动禁用三个临时账号，不保留可登录的 UAT 测试凭据。

## 门禁证据

- 干净 PostgreSQL 15 成功应用全部 37 个 migration；远程 migration 容器成功应用 `20260712203000_engineering_change_orders`。
- `npm run validate` 通过：API 45 suites / 428 tests，Web 7 suites / 42 tests。
- API/Web typecheck、lint、生产构建通过；现有历史 lint warning 数量未增加。
- `npm run compose:config` 通过五套 Compose 配置。
- migration 容器退出码为 `0`。
- API、Web、PostgreSQL、Redis、MinIO 全部 healthy。
- `/api/health` 返回 `status: ok`，`/dashboard/files` 返回 HTTP 200。

## 边界

- 本批完成受控工程文档、工单固定版本及 ECO 影响处置的 Phase 3 tracer bullet。
- ECO 当前覆盖图纸版本和在制工单处置；BOM 版本固定与 ECO 联动仍属于后续制造深化范围。
- 该结果是受控 UAT 证据，不替代生产备份恢复、HTTPS、生产权限分配和上线签字门禁。
