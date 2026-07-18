# Web 工作区稳定性受控 UAT

日期：2026-07-13（Asia/Shanghai）

当前部署标签：`uat-676364e`

分支：`refactor/remaining-tasks`

## 范围

- 稳定仪表盘导航标签、设置页公司信息、自定义字段和员工管理的 Hook 依赖。
- 异步引用选择器在语言切换后使用最新翻译，同时保持选中项和搜索请求的取消语义。
- 登录、邀请接受、试算平衡表、AI 命令、Chat2Dash/Chat2SQL 和 OCR 上传统一使用类型安全的 API 错误消息读取。
- 订单时间线使用明确事件类型，不再以 `any` 透传服务端数据。
- 销售订单抽屉使用明确订单详情响应类型；价格解析、产品合并和详情加载使用稳定回调，避免列定义和加载效果捕获陈旧数据。
- DataGrid 将 TanStack 异构列值类型擦除和 React Compiler 不兼容限制在两处有说明的公共边界，业务页面不再扩散显式 `any` 或全局禁用规则。

## 门禁证据

- `npm run validate` 通过：API 45 suites / 440 tests，Web 8 suites / 48 tests。
- API/Web typecheck、lint 和生产构建通过。
- Web lint warning 从本轮开始前的 64 条降至 0；API lint 的 7 条测试类型告警也已清零，全仓 lint 当前无告警。
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

## DataGrid 编译器边界增量部署

- `8dbfac5` 仅修改 Web 源码，API 和 migration 复用当前受控 UAT 的相同构建内容并追加精确提交标签。
- Web-only 归档大小为 `96706380` 字节，本地与远端 SHA-256 均为 `c86e6cb1ab839bf33797b64602f9861d08280566ff2efd91230ffd9826d395a5`。
- 远程 `oneerp_test` 已切换至 `IMAGE_TAG=uat-8dbfac5`；长期服务均为 healthy，migration 退出码为 0，API 与 Web 均返回 HTTP 200。

## 生产登录引导增量部署

- `499f7ff` 使生产构建不再默认预填本地管理员邮箱，也不再显示 `.env.quickstart` 密码路径；增加密码显示/隐藏、自动填充语义和可访问错误提示。
- `npm run validate` 通过：API 45 suites / 452 tests，Web 11 suites / 55 tests；全部 Compose 配置和 GitHub validate、commitlint、CodeQL 通过。
- 远程 `oneerp_test` 已切换至 `IMAGE_TAG=uat-499f7ff`；长期服务均为 healthy，migration 退出码为 0。
- 通过 SSH 隧道实机确认生产登录页账号为空、管理员帮助文案正确、无 quickstart 密码路径，密码显示/隐藏交互有效。

## 售前工作台响应式增量部署

- `d7d71ca` 为客户需求工作台增加 350ms 搜索防抖、过期请求隔离、加载失败重试、中文状态标签和移动端换行/单列输入布局；共享 `Sheet` 增加 dialog 语义、Esc 关闭、焦点恢复和后台滚动锁。
- `npm run validate` 通过：API 45 suites / 452 tests，Web 12 suites / 61 tests；`npm run compose:config`、GitHub validate、commitlint 和 CodeQL 全部通过。
- `graphify update .` 完成：3747 nodes、7649 edges、281 communities。
- 本地 Docker BuildKit 初始化锁导致两次构建停在 0/0 步，因此使用同一提交全量 `next build` 的 standalone 运行产物追加到已验证的 Web 基础镜像；运行产物归档大小 `23313408` 字节，本地与远端 SHA-256 均为 `4554d7c805a61cfd0dfd7c42987189930c97f075a11950c33996b69b643ce8d2`。
- 远端 Web 构建 ID 与本地均为 `LtM4dYHY0pGUIyImKWVnI`；`oneerp_test` 已切换至 `IMAGE_TAG=uat-d7d71ca`，长期服务均为 healthy，migration 退出码为 0，API 健康端点和 Web 工作台路由均返回 HTTP 200。
- 部署使用临时 overlay 镜像，不是正式 GHCR 发布物；临时容器、远端归档和本地归档均已删除，保留上一标签用于回滚。

## 同源 API 与嵌套路由标签增量部署

- `8c02541` 将 Web 客户端默认 API 地址改为同源 `/api/proxy`，避免生产浏览器产物固化 `127.0.0.1:8000/api`。生产构建静态产物中该回环地址出现次数为 0，`/api/proxy` 出现在 3 个客户端 chunk。
- `676364e` 修复嵌套 Dashboard 路由的标题、工作区标签和侧边栏激活状态；`/dashboard/sales/requirements` 显示“客户需求”，销售导航保持激活。
- `npm run validate` 通过：API 45 suites / 452 tests，Web 14 suites / 66 tests；API/Web typecheck、lint、生产构建和全部 Compose 配置均通过。
- Graphify 更新完成：3759 nodes、7668 edges、285 communities。
- 功能提交 `676364e` 的 GitHub validate、commitlint、CodeQL 均通过；PR #15 保持 Draft。
- 远程 `oneerp_test` 已切换至 `IMAGE_TAG=uat-676364e`；API、Web、PostgreSQL、Redis 和 MinIO 均为 healthy，migration 容器退出码为 0，API `/api/health` 和 Web `/login` 均返回 HTTP 200。
- 桌面浏览器验收确认：登录成功；客户需求页面、头部标题和工作区标签正确；搜索 `REQ-2026-000009` 仅返回目标记录；新建需求抽屉具备 dialog 语义；Esc 关闭后焦点恢复；页面无横向溢出。
- 浏览器工具设置 `390x844` 后页面仍报告 `1280x720`，因此本轮不声称已完成真实移动视口视觉验收；移动端仅有响应式样式契约和自动化交互覆盖。

## 临时资源收尾

- 2026-07-19 复核 `oneerp_test` 仍运行 `uat-676364e`，五个长期服务均为 healthy，migration 退出码为 0，API 健康端点和 Web 登录页均返回 HTTP 200。
- 浏览器验收使用的合成 UAT 账号已禁用，数据库 `isActive=false`；未删除该记录，以保留审计历史。
- `CORS_ORIGINS` 已恢复为仅包含 `https://oneerp-test.yutsufun.com`，API 已强制重建并恢复 healthy。
- 远端 `/tmp/oneerp-web-overlay-676364e*` 文件数为 0；历史 UAT 数据卷和回滚镜像保留。

## 边界

- 本次仅为受控 UAT，不代表生产就绪。
- 登录页和售前工作台已完成桌面真实浏览器交互检查；移动视口视觉检查仍待在可可靠控制 viewport 的浏览器环境中完成。
