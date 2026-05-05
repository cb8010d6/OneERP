# 📋 OneERP Backlog (待办事项)

> 最后更新：2026-05-05 · 版本：1.0.0
> 维护人：项目总结构师

---

## 优先级定义

| 级别 | 含义                       | 响应时间     | 完成时限  |
| ---- | -------------------------- | ------------ | --------- |
| **P0** | 阻塞性问题 / 生产事故     | 立即响应     | 24 小时内 |
| **P1** | 核心功能缺失 / 严重缺陷   | 当天响应     | 1 周内    |
| **P2** | 功能增强 / 体验优化        | 排入迭代     | 当前迭代  |

---

## P0 — 阻塞性 / 生产事故

> 当前无 P0 待办事项。

---

## P1 — 核心功能缺失 / 严重缺陷

### P1-001 生产事件驱动缺失

**现状**：`ProductionModule` 的工单完成（COMPLETED）未发射任何事件，导致：
- 工单完成后无法自动触发订单状态流转
- 无法自动触发成品入库过账

**预期**：
- `ProductionService.submitWorkReport()` 中，当 `actualQty >= plannedQty` 时发射 `production.work_order.completed` 事件
- `ProductionModule` 新增 `ProductionWorkflowListener` 监听该事件
- 事件处理器调用 `WorkflowService.transition()` 推进订单状态

**影响范围**：生产→订单→库存全链路

---

### P1-002 采购流程无独立实体

**现状**：采购流程目前复用 `Order` 模型或通过 `InventoryService.postPurchaseInbound()` 直接入库，缺少：
- 独立的采购订单实体（PurchaseOrder）
- 采购审批流程
- 采购与供应商的关联

**预期**：
- 新增 `PurchaseOrder` / `PurchaseOrderItem` 模型
- 新增 `PurchaseModule`（Controller + Service）
- 集成 Workflow 引擎支持采购审批状态机
- 采购入库自动关联采购单

**影响范围**：采购、库存、财务

---

### P1-003 凭证冲销功能缺失

**现状**：`AccountingService` 仅支持正向记账，缺少：
- 凭证冲销（红冲）
- 凭证反审核
- 试算平衡表查询

**预期**：
- `postInvoicePostedEntry()` 支持 `action: 'reverse'` 参数
- 生成红字凭证（借贷方向反转）
- `JournalEntry` 状态流转：DRAFT → POSTED → CANCELLED
- 新增试算平衡表 API

**影响范围**：财务模块

---

### P1-004 事件重试无定时任务

**现状**：`EventQueueService.retryPending()` 已实现，但缺少定时调用机制。当前需手动调用 API 触发重试。

**预期**：
- 使用 `@nestjs/schedule` 的 `@Cron()` 装饰器
- 每 5 分钟执行 `retryPending()`
- 每小时执行 `FinanceDlqService.retryPending()`

**影响范围**：事件系统可靠性

---

### P1-005 生产环境部署配置不完整

**现状**：`deploy.yml` 中部署步骤为 placeholder，未配置实际部署命令。

**预期**：
- 配置 SSH 部署或 Docker Compose 部署
- 添加健康检查步骤
- 配置回滚机制

**影响范围**：CI/CD、生产环境

---

## P2 — 功能增强 / 体验优化

### P2-001 实时库存预警通知

**现状**：`OrderCreatedListener` 检测到低库存后仅写入 AuditLog，无主动通知机制。

**预期**：
- 集成 WebSocket 或 Server-Sent Events
- 低库存时实时推送到前端通知中心
- 可选：集成企业微信/钉钉 webhook 通知

**影响范围**：库存、通知

---

### P2-002 Dashboard 数据聚合增强

**现状**：`DashboardModule` 功能基础，缺少：
- 销售趋势图表
- 库存周转率分析
- 应收账款账龄分析
- 生产效率看板

**预期**：
- 新增聚合 API 使用 Kysely 高性能查询
- 支持日期范围筛选
- 支持导出 Excel

**影响范围**：Dashboard、前端

---

### P2-003 审计日志查询 API

**现状**：`AuditService.getTimeline()` 仅支持按单个实体查询，缺少：
- 全局审计日志搜索
- 按用户/操作类型筛选
- 审计日志导出

**预期**：
- 新增 `GET /api/audit-logs` 列表 API
- 支持 `filter`、`search`、`orderBy` 参数
- 支持 CSV 导出

**影响范围**：审计模块

---

### P2-004 文件管理增强

**现状**：`FilesModule` 仅支持基础上传/下载，缺少：
- 文件关联业务单据
- 文件版本管理
- 文件预览（图片/PDF）

**预期**：
- `FileRecord` 新增 `entityType` / `entityId` 字段
- 支持文件预签名 URL
- 前端文件预览组件

**影响范围**：文件模块、前端

---

### P2-005 多语言支持 (i18n)

**现状**：系统界面和 API 错误信息均为中文硬编码。

**预期**：
- API 错误信息支持 i18n key
- 前端集成 `next-intl` 或 `react-i18next`
- 支持中/英双语切换

**影响范围**：全栈

---

### P2-006 权限细化 (RBAC)

**现状**：`Role` 模型已有 `permissions` 字段，但未在 API 层实现权限校验。

**预期**：
- 新增 `PermissionsGuard`
- 在 Controller 方法上添加 `@RequirePermissions('order:write')` 装饰器
- 前端根据权限动态渲染菜单和按钮

**影响范围**：认证、全栈

---

### P2-007 API 限流配置

**现状**：已引入 `@nestjs/throttler` 依赖，但未配置全局限流规则。

**预期**：
- 配置默认限流：60 次/分钟
- 认证接口加强限流：10 次/分钟
- 文件上传接口独立限流

**影响范围**：API 安全

---

### P2-008 测试覆盖率提升

**现状**：当前测试覆盖不足，关键业务链路缺少集成测试。

**预期**：
- 核心 Service 单元测试覆盖率 > 80%
- 关键业务链路（订单→发货→记账）集成测试
- CI 中启用覆盖率报告

**影响范围**：质量保障

---

## 已完成项

| 编号      | 标题                   | 完成日期   |
| --------- | ---------------------- | ---------- |
| DONE-001  | 多公司多租户架构       | 2026-03    |
| DONE-002  | 通用 CRUD 引擎         | 2026-03    |
| DONE-003  | 元数据驱动自定义字段   | 2026-03    |
| DONE-004  | 状态机工作流引擎       | 2026-03    |
| DONE-005  | 审计日志系统           | 2026-03    |
| DONE-006  | 复式库存过账           | 2026-03    |
| DONE-007  | 自动记账凭证           | 2026-03    |
| DONE-008  | 事件队列 + DLQ + 幂等  | 2026-03    |
| DONE-009  | 税码引擎               | 2026-05    |
| DONE-010  | 订单→发货→出库→记账全链路 | 2026-05 |