# 销售发货工作台本地 UAT

日期：2026-07-13（Asia/Shanghai）
部署标签：`uat-b13d122`
分支：`refactor/remaining-tasks`

## 范围

- 订单详情页不再用普通工作流按钮直接把生产中订单标记为已发货。
- `IN_PRODUCTION` 和 `PARTIAL_SHIPPED` 订单显示真实销售发货过账面板。
- 默认模式为“整单原子过账”，只有用户显式勾选后才提交 `allowPartial=true`。
- 面板支持选择来源库位、指定批次和备注、逐行调整本次发货数量。
- 成功结果显示已过账行数、跳过行数和实际订单状态；部分发货显示每条跳过原因。

## 验证证据

- Web 定向交互测试 2/2 通过：默认请求携带 `allowPartial=false`；显式部分发货携带 `allowPartial=true` 并展示跳过原因。
- `npm run validate` 通过：API 45 suites / 440 tests，Web 8 suites / 46 tests。
- API/Web typecheck、lint、生产构建通过；仅保留既有 lint warning。
- `npm run compose:config` 通过全部 Compose 配置。
- Graphify 更新为 3672 nodes、7516 edges、279 communities。

## 本地隔离部署

- 远程 UAT SSH 端口持续重置连接，未切换远程 `oneerp_test`。
- 已启动隔离的本地 PostgreSQL、Redis、API 和 Web 容器，成功应用全部 39 个 migration。
- 本地 API `http://127.0.0.1:18001/api/health` 返回 HTTP 200。
- 本地 Web `http://127.0.0.1:13001/dashboard/orders/{id}` 返回 HTTP 200。
- Web `/api/proxy` 到 API 的登录请求成功，返回 access token 和公司上下文。
- 创建真实 `IN_PRODUCTION` 测试订单 `ORD-202607-1087` 供订单详情页交互验证。

## 边界

- 当前会话未提供浏览器控制运行时，因此没有把 HTTP、测试或构建结果冒充为视觉截图验收。
- 远程 SSH 恢复后，仍需把相同标签上传到 `oneerp_test` 并完成一次浏览器视觉检查。
- 本地隔离栈仅用于受控界面验收，不代表生产就绪。
