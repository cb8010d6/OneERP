# OneERP 发布说明

本文件记录对外可读的版本价值、上线风险和验收状态。详细开发任务仍以 `docs/plans/` 和提交记录为准。

## 2026-05-20 - 生产试运行基础版

### 发布定位

本版本面向“真实库存/财务生产试运行”的第一阶段：不追求复杂多活架构，优先把单机部署、数据精度、账号安全、库存/财务基础可靠性和前端关键交互做扎实。

### 关键价值

- **部署更简单**：`scripts/start-local-prod.ps1` 会在构建时执行 Prisma migration，减少“代码已更新但数据库没升级”的常见故障。
- **财务更可靠**：核心金额、税率、库存数量字段迁移到 PostgreSQL Decimal，降低浮点误差进入凭证和库存台账的风险。
- **账号更安全**：新增 15 分钟 Access Token、7 天 Refresh Token、刷新令牌轮换、登录失败锁定和强密码策略。
- **销售更可信**：订单金额由后端产品销售价计算，通用 CRUD 不能绕过订单专用接口改价或写明细。
- **库存更可用**：库存台账分页查询，销售发货支持多批次分配和部分发货状态，避免大数据量拖垮 Node 进程。
- **前端更可扩展**：新增基础 UI 组件与统一金额/日期格式化工具，销售明细产品选择支持 AsyncSelect。

### 已通过验证

- `npm run validate`
- Prisma schema validate/generate
- API/Web typecheck
- API/Web lint
- API/Web 单元测试
- API/Web production build

### 已知限制

- Web lint 仍有历史 warning，主要是 `any` 类型和 React Hook dependency 提示；当前不阻塞构建。
- 采购全链路、生产 BOM/WIP、财务关账、总账/明细账仍在后续迭代。
- AI 写操作仍默认关闭，生产只允许只读/草稿辅助能力。
- 单机增强部署需要 Docker Desktop 或 Docker Engine 正常运行。

### 上线前必须完成

- 执行 `docs/GO_LIVE_CHECKLIST.md`。
- 记录备份位置、恢复责任人和最近一次恢复演练结果。
- 修改默认管理员密码，并确认员工权限验收通过。
- 使用真实业务数据跑通采购、销售、库存、发票过账和试算平衡验收。
