# Web 工作区稳定性受控 UAT

日期：2026-07-13（Asia/Shanghai）  
当前部署标签：`uat-2f2f8f7`  
分支：`refactor/remaining-tasks`

## 范围

- 稳定仪表盘导航标签、设置页公司信息、自定义字段和员工管理的 Hook 依赖。
- 异步引用选择器在语言切换后使用最新翻译，同时保持选中项和搜索请求的取消语义。
- 登录、邀请接受、试算平衡表、AI 命令、Chat2Dash/Chat2SQL 和 OCR 上传统一使用类型安全的 API 错误消息读取。
- 订单时间线使用明确事件类型，不再以 `any` 透传服务端数据。
- 销售订单抽屉使用明确订单详情响应类型；价格解析、产品合并和详情加载使用稳定回调，避免列定义和加载效果捕获陈旧数据。

## 门禁证据

- `npm run validate` 通过：API 45 suites / 440 tests，Web 8 suites / 48 tests。
- API/Web typecheck、lint 和生产构建通过。
- Web lint warning 从本轮开始前的 64 条降至 31 条；剩余告警继续作为后续迭代项，不阻塞本次受控 UAT。
- `npm run compose:config` 通过全部 Compose 配置。
- `graphify update .` 完成：3680 nodes、7537 edges、276 communities。

## 部署证据

- 归档大小为 `465470921` 字节，本地与远端 SHA-256 均为 `8216b540154d997a48e6b0f97812fcc30587e99a777054bb1b439afc9917ca51`。
- 远程 `oneerp_test` 已切换至 `IMAGE_TAG=uat-d1c4824`。
- API、Web、PostgreSQL、Redis 和 MinIO 均为 healthy；migration 容器退出码为 0。
- API `/api/health` 和 Web `/login` 均返回 HTTP 200。

## 销售订单抽屉增量部署

- `2f2f8f7` 仅修改 Web 源码，API 和 migration 复用当前受控 UAT 的相同构建内容并追加精确提交标签。
- Web-only 归档大小为 `96705016` 字节，本地与远端 SHA-256 均为 `d32da33867ec3d6b927bd4b60723b32c35361a5e723d501e0e64aadc6679e0d5`。
- 远程 `oneerp_test` 已切换至 `IMAGE_TAG=uat-2f2f8f7`；长期服务均为 healthy，migration 退出码为 0，API 与 Web 均返回 HTTP 200。

## 边界

- 本次仅为受控 UAT，不代表生产就绪。
- 当前验证覆盖自动化交互、构建和 HTTP 健康状态；真实浏览器视觉检查仍需浏览器控制运行时。
