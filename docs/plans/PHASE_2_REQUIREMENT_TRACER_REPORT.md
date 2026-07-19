# Phase 2 客户需求 Tracer 实施与 UAT 报告

> 日期：2026-07-11  
> 分支：`refactor/remaining-tasks`  
> 功能提交：`d0ee16189f8e5061cdaca90fff756ceae99a43cf`  
> 结论：客户需求 tracer 已达到受控 UAT 标准；不代表完整 Phase 2 或生产就绪。

## 交付范围

- `REQ-YYYY-######` 公司级年度原子序列。
- 客户需求创建、分页查询、单号/摘要/客户搜索和状态筛选。
- 不可变跟进活动；首次跟进将 `DRAFT` 推进为 `FOLLOWING`。
- 丢单/取消关闭；丢单强制填写原因，终态禁止继续跟进。
- 事务内审计、Partner 公司/类型校验和 Prisma 租户模型白名单。
- Sales/Admin 角色模板增加需求单动作权限。
- `/dashboard/sales/requirements` 工作台和销售订单页入口。

## API

| Method | Path | 权限 | 行为 |
| --- | --- | --- | --- |
| `POST` | `/api/presales/requirements` | `requirement:create` | 创建 `DRAFT` 需求单 |
| `GET` | `/api/presales/requirements` | `requirement:read` | 公司级分页、搜索和状态筛选 |
| `POST` | `/api/presales/requirements/:id/follow-ups` | `requirement:follow-up` | 追加跟进活动并更新下次跟进时间 |
| `POST` | `/api/presales/requirements/:id/close` | `requirement:update` | 标记 `LOST` 或 `CANCELLED` |

## 验证证据

### TDD 与本地门禁

- 逐条观察到服务不存在、列表方法不存在、跟进方法不存在、关闭成功路径未实现等 RED，再完成 GREEN。
- API：41/41 套件、390/390 测试通过。
- Web：5/5 套件、35/35 测试通过。
- Prisma validate/generate、两端 typecheck/lint/build 通过；仅保留既有 lint warnings。
- `npm run compose:config` 验证 dev、easy、HA-lite、prod 和 2 GB UAT override。

### 真实数据库

- 使用独立 `postgres:15-alpine` 容器和空数据库。
- 29 个 migration 全部按顺序应用，新 migration 为 `20260711001000_presales_customer_requirements`。
- 数据库 E2E 完成创建、按单号查询、跟进和丢单关闭；测试数据清理后删除容器。

### 远程 2 GB UAT

- 三个临时镜像：`oneerp-api:uat-d0ee161`、`oneerp-api-migrate:uat-d0ee161`、`oneerp-web:uat-d0ee161`。
- 上传包 SHA-256：`042ab6f83f0d476383522406c281e9ed125c158cf3684f6bbbbd812a8276355f`；远程校验通过后加载镜像并删除临时包。
- API、Web、PostgreSQL、Redis、MinIO 健康；migration 容器退出码 0。
- 原 9 步 `business-acceptance` 再次通过，报告 `business-acceptance-report-d0ee161.json` 的 `passed=true`。
- 新切片认证 HTTP 验收：`REQ-2026-000001` 完成 `DRAFT -> FOLLOWING -> LOST`。
- Web 新路由返回 200；本地 SSH 隧道恢复后，内置浏览器可到达 OneERP 登录页且无 console error/warn。

## 回滚

- 远程部署前的 `.env` 备份：`.env.before-d0ee161-20260711`，仅保留在 UAT 主机且不进入 Git。
- 如应用回滚，可恢复旧 `IMAGE_TAG` 并重新执行相同 Compose；本次 migration 只新增表和索引，旧应用可继续运行。
- 不应在有 UAT 需求数据后直接删除新表；数据回退应先导出/保留审计记录。

## 下一步

开始报价 tracer 前，先实现并评审：报价/版本/行快照模型、CNY 本位币汇率端口、发出后不可变、V2 替代 V1、报价发送/接受权限和失败测试。合同与订单幂等转化继续保持为后续独立批次。
