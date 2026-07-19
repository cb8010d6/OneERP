# 合同工作台 UAT / Contract Workbench UAT

日期：2026-07-12（Asia/Shanghai）  
部署标签：`uat-184a4a5`  
分支：`refactor/remaining-tasks`

## 范围

- 已接受报价版本登记合同 V1。
- 合同编号、来源报价版本、金额和草稿状态校验。
- 需求工作台的合同登记 Sheet，以及已登记后的合同状态展示。
- 本批不包含合同审批、签署文件或转销售订单。

## 自动验收

在 UAT 服务器 `oneerp_test` 项目中执行 `scripts/quote-lifecycle-acceptance.mjs`，结果：

```text
REQ-2026-000005
QT-2026-000004
V1 -> SENT
V2 -> ACCEPTED
CT-2026-000001 / V1 / DRAFT
total=250
passed=true
```

迁移容器日志确认 `20260711003000_sales_contracts` 已成功应用，API `/api/health` 返回 `{"status":"ok"}`，Web `/login` 返回 HTTP 200。API、Web、PostgreSQL、Redis、MinIO 均为 healthy。

## 浏览器检查

- 登录页桌面视口 1280px：无横向溢出，控制台错误 0。
- 登录页移动视口 390px：无横向溢出，控制台错误 0。
- 当前浏览器没有远程 UAT 登录态，因此未代填或读取管理员密码；已登录后的合同工作台由前端回归测试和上述真实 HTTP 验收覆盖。

## 资源

部署前服务器约 1.1 GiB 可用内存、25 GiB 可用磁盘；本次部署未触发资源不足，因此未切换到本地部署。

## 结论

合同 V1 工作流已在受控 UAT 环境通过。该证据不等同于生产就绪；生产仍需按 `docs/PRODUCTION_READINESS.md` 完成备份恢复、HTTPS、权限、库存和财务门禁。
