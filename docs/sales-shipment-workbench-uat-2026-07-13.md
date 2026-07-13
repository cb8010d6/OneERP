# 销售发货工作台受控 UAT

日期：2026-07-13（Asia/Shanghai）
当前部署标签：`uat-eb97174`
分支：`refactor/remaining-tasks`

## 范围

- 订单详情页不再用普通工作流按钮直接把生产中订单标记为已发货。
- `IN_PRODUCTION` 和 `PARTIAL_SHIPPED` 订单显示真实销售发货过账面板。
- 默认模式为“整单原子过账”，只有用户显式勾选后才提交 `allowPartial=true`。
- 面板支持选择来源库位、指定批次和备注、逐行调整本次发货数量。
- 成功结果显示已过账行数、跳过行数和实际订单状态；部分发货显示每条跳过原因。
- 通用订单看板不再允许把 `IN_PRODUCTION` 直接拖到 `SHIPPED`；订单抽屉的相同动作改为打开销售发货工作台。
- AI 工作流工具改为安全白名单，仅暴露销售订单 `submit`、`start_production` 和 `complete`；销售发货、生产工单完成、发票过账与订单取消必须在对应业务工作台执行。
- 根 `WorkflowService` 增加领域事务守卫：通用 Workflow API 禁止销售发货、生产工单状态变更和发票状态变更；已部分发货或已发货订单在库存恢复前禁止取消。
- 订单详情页同步隐藏已部分发货和已发货订单的普通取消按钮，避免界面引导用户走不完整的库存流程。

## 验证证据

- Web 定向交互测试 2/2 通过：默认请求携带 `allowPartial=false`；显式部分发货携带 `allowPartial=true` 并展示跳过原因。
- 看板边界定向测试 3/3 通过：库存相关发货被阻断，普通订单流转保持可用，生产中/部分发货订单均路由到发货工作台。
- 工作流领域守卫定向测试 5/5、看板边界定向测试 4/4 通过。
- `npm run validate` 通过：API 45 suites / 450 tests，Web 9 suites / 52 tests。
- API/Web typecheck、lint、生产构建通过，lint 为零错误。
- `npm run compose:config` 通过全部 Compose 配置。
- Graphify 更新为 3710 nodes、7590 edges、277 communities。

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

## AI 发货旁路封堵

- API runtime 归档大小为 `154686193` 字节，本地与远端 SHA-256 均为 `e47107d666850ce457f2d05eb6088455cc43e119e8a8a24a8d0a1d17604aa117`。
- 远程 `oneerp_test` 已切换至 `IMAGE_TAG=uat-b223ea5`；长期服务均为 healthy，migration 退出码为 0，API 与 Web 均返回 HTTP 200。
- 远端真实验收脚本 `scripts/ai-shipment-guard-acceptance.mjs` 返回：`status=400`、`shipmentDraftBlocked=true`、`workflowGuidanceVerified=true`。

## AI 工作流安全白名单

- API runtime 归档大小为 `154686929` 字节，本地与远端 SHA-256 均为 `903aa7bbe68f486d46c0a48fe4e957a8a383b27112c2015f84765c4a0aea42d8`。
- 远程 `oneerp_test` 已切换至 `IMAGE_TAG=uat-d8d7283`；长期服务均为 healthy，migration 退出码为 0，API 与 Web 均返回 HTTP 200。
- 扩展远端真实验收通过：`schemaWhitelistVerified=true`、`shipmentDraftBlocked=true`、`workOrderCompletionBlocked=true`、`invoicePostingBlocked=true`、`orderCancellationBlocked=true`。

## 根工作流领域事务守卫

- API/Web 组合归档大小为 `194234728` 字节，本地与远端 SHA-256 均为 `a63031c7269a75ca152a3b9a12435bec8f4c081db263bec4cec8c16cfb35bd63`。
- 远程 `oneerp_test` 已切换至 `IMAGE_TAG=uat-dcc2122`；API、Web、PostgreSQL、Redis 和 MinIO 均为 healthy，migration 容器退出码为 0。
- 远程 API 健康端点返回 `status=ok`，Web 根路径返回预期的登录重定向。
- 扩展远端真实验收通过：`schemaWhitelistVerified=true`、`shipmentDraftBlocked=true`、`workOrderCompletionBlocked=true`、`invoicePostingBlocked=true`、`orderCancellationBlocked=true`、`directWorkflowShipmentBlocked=true`。
- 本次部署仍为受控 UAT，不代表生产就绪。

## 可重复销售发货冲销

- 订单详情页新增“发货冲销与回库”工作台：必须显式确认影响，可选择回库库位、填写冲销原因，并显示反向流水结果与本订单退货单历史。
- 销售发货剩余量改为按 `出库 - 冲销回库` 净额计算；冲销后可重新发货，查询返回顺序不会影响净额。
- 首次冲销继续使用历史兼容编号 `SALE-SHIP-REV-{orderNo}`；后续发货周期使用独立后缀编号和独立退货单。
- 首轮远端 UAT 暴露冲销未继承原出库批次，导致指定原批次重新发货时库存不足；`eb97174` 增加失败回归测试并修复为默认继承原批次，调用方仍可显式覆盖批次。
- `npm run validate` 通过：API 45 suites / 452 tests，Web 10 suites / 53 tests；API/Web lint、typecheck 和生产构建通过。
- Graphify 更新为 3722 nodes、7611 edges、278 communities。
- API/Web 组合归档 `uat-70943e1` 大小为 `194247729` 字节，本地与远端 SHA-256 均为 `0f2e6de994e759e793a8681bf8eee296e4393206e0fb8bc1c1cbc4e653765f50`。
- 批次修复 API 归档 `uat-eb97174` 大小为 `154689929` 字节，本地与远端 SHA-256 均为 `633b636e9fdb6f519cafe33a94e49432ac77a32c621202d6dd74f435d968d517`。
- 远程 `oneerp_test` 已切换至 `IMAGE_TAG=uat-eb97174`；全部长期服务 healthy，migration 容器退出码为 0，API 健康端点返回 `status=ok`。
- 最终真实 UAT：`failedShipmentStatus=409`、`stockRolledBack=true`、`orderStatusRolledBack=true`、`noPartialTransactions=true`、`firstReversalRestoredStock=true`、`reversalReplayIdempotent=true`、`reshipAfterReversalPassed=true`、`secondReversalCyclePassed=true`，最终订单状态为 `IN_PRODUCTION`。
- 本轮部署为受控 UAT，不代表生产就绪。
