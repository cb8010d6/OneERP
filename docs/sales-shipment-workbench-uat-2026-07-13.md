# 销售发货工作台受控 UAT

日期：2026-07-13（Asia/Shanghai）
当前部署标签：`uat-e08da07`
分支：`refactor/remaining-tasks`

## 范围

- 订单详情页不再用普通工作流按钮直接把生产中订单标记为已发货。
- `IN_PRODUCTION` 和 `PARTIAL_SHIPPED` 订单显示真实销售发货过账面板。
- 默认模式为“整单原子过账”，只有用户显式勾选后才提交 `allowPartial=true`。
- 面板支持选择来源库位、指定批次和备注、逐行调整本次发货数量。
- 成功结果显示已过账行数、跳过行数和实际订单状态；部分发货显示每条跳过原因。
- 通用订单看板不再允许把 `IN_PRODUCTION` 直接拖到 `SHIPPED`；订单抽屉的相同动作改为打开销售发货工作台。

## 验证证据

- Web 定向交互测试 2/2 通过：默认请求携带 `allowPartial=false`；显式部分发货携带 `allowPartial=true` 并展示跳过原因。
- 看板边界定向测试 3/3 通过：库存相关发货被阻断，普通订单流转保持可用，生产中/部分发货订单均路由到发货工作台。
- `npm run validate` 通过：API 45 suites / 440 tests，Web 8 suites / 46 tests。
- API/Web typecheck、lint、生产构建通过；仅保留既有 lint warning。
- `npm run compose:config` 通过全部 Compose 配置。
- Graphify 更新为 3672 nodes、7516 edges、279 communities。

## 部署验证

- 镜像归档大小为 `465472112` 字节，本地与远端 SHA-256 均为 `f2078da7590eee2e527d7a487b90bb5ed8031721530a64751587aa0f5c9626a5`。
- 远程 `oneerp_test` 已切换到 `IMAGE_TAG=uat-b13d122`；API、Web、PostgreSQL、Redis 和 MinIO 均为 healthy，migration 容器退出码为 0。
- 远程 API `http://127.0.0.1:18000/api/health` 和 Web `http://127.0.0.1:13000/login` 均返回 HTTP 200。
- 远程连接中断期间已启动隔离的本地 PostgreSQL、Redis、API 和 Web 回退容器，并成功应用全部 39 个 migration。
- 本地 API `http://127.0.0.1:18001/api/health` 返回 HTTP 200。
- 本地 Web `http://127.0.0.1:13001/dashboard/orders/{id}` 返回 HTTP 200。
- Web `/api/proxy` 到 API 的登录请求成功，返回 access token 和公司上下文。
- 创建真实 `IN_PRODUCTION` 测试订单 `ORD-202607-1087` 供订单详情页交互验证。

## 边界

- 当前会话未提供浏览器控制运行时，因此没有把 HTTP、测试或构建结果冒充为视觉截图验收。
- 自动交互测试覆盖请求模式和结果呈现，但真实浏览器视觉检查仍待具备浏览器控制运行时后补充。
- 本地隔离栈仅用于受控界面验收，不代表生产就绪。
- 远程部署为受控 UAT，不代表已完成生产上线门禁。

## 旁路封堵增量部署

- `e08da07` 仅修改 Web 源码，API 和 migration 复用上一受控 UAT 的相同构建内容并追加精确提交标签。
- Web-only 归档大小为 `96701974` 字节，本地与远端 SHA-256 均为 `ae34b059685be30bf67b30cd2b2860b1e0676a148a075b7def644c0af491ba7b`。
- 远程 `oneerp_test` 已切换至 `IMAGE_TAG=uat-e08da07`；全部长期服务 healthy，migration 退出码为 0，API 与 Web 均返回 HTTP 200。
