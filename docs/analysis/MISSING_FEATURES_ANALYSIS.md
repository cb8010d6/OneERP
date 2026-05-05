# OneERP 缺失功能分析报告

> **生成日期**: 2026-03-26
> **分析范围**: 后端 API、前端 Web、数据库模型、核心引擎
> **对比基准**: `docs/plans/` 中的规划文档

---

## 执行摘要

OneERP 项目已经完成了**扎实的技术基础架构**（元数据驱动、通用 CRUD、事件总线、多租户），但在**业务模块完整性**和**企业级特性**方面存在显著缺口。

### 当前完成度评估

| 模块分类 | 完成度 | 状态 |
|---------|-------|------|
| 核心引擎（CRUD/Metadata/Event） | 90% | ✅ 优秀 |
| 销售订单模块 | 70% | ⚠️ 基础完成 |
| 库存管理 | 60% | ⚠️ 缺少关键保护 |
| **采购模块** | **0%** | ❌ **完全缺失** |
| 生产管理 | 50% | ⚠️ 仅有工单 |
| 财务会计 | 40% | ⚠️ 记账存在但不完整 |
| **税务引擎** | **60%** | ✅ **TaxCode 模型 + 动态税码解析已落地** |
| AI 功能 | 65% | ✅ LLM Function Calling + Chat2SQL + 规则引擎兜底已落地 |
| 报表系统 | 10% | ❌ 缺少财务三表 |

---

## 一、高优先级缺失功能 (P0 - 阻塞性)

### 🔴 1. 采购管理全链路（Purchase Management）

**问题严重性**: ⚠️ **业务闭环受阻** - 无法完成"采购→收货→应付→付款"完整链路

#### 组件状态（已更新 2026-05-05）清单

##### 数据库层
```prisma
// ❌ 以下模型完全不存在于 schema.prisma

model PurchaseOrder {
  // 采购订单主表
}

model PurchaseOrderLine {
  // 采购订单明细
}

model GoodsReceipt {
  // 收货单（与采购单关联）
}

model PurchaseRequisition {
  // 采购申请单（可选但推荐）
}
```

##### 后端服务层
- ❌ 无 `PurchaseOrdersModule`
- ❌ 无供应商询价接口
- ❌ 无三单匹配逻辑（PO ↔ GR ↔ Invoice）
- ❌ 无收货入库自动触发库存增加的事件监听器

##### 前端页面
- ❌ 无采购订单列表页
- ❌ 无采购单创建/编辑表单
- ❌ 无收货单执行界面

#### 影响范围
- 📦 **供应链断裂**: 无法管理原材料采购
- 💰 **应付账款无源头**: 现有 Invoice 无法关联采购订单
- 📊 **成本核算缺失**: 库存成本无法从采购价推导

#### 推荐行动
**优先级**: P0 - 立即开发
**预计工期**: 2 周
**负责人**: Backend + Frontend 协同

---

### 🔴 2. 可配置税务引擎（Configurable Tax Engine）

**问题严重性**: ⚠️ ~~合规风险~~ → **已修复** — TaxCode 主数据模型与动态税率解析已落地

#### 当前问题 → 已修复

**已修复 (2026-05-05)**：inance.service.ts 现在通过 esolveTaxCode() 从数据库动态查找税码，未指定时回退到默认税码或 13% 兜底。
#### 组件状态（已更新 2026-05-05）

##### 数据库层
```prisma
// ❌ 不存在

model TaxCode {
  id          String  @id @default(cuid())
  code        String  @unique  // "VAT_13", "GST_5"
  name        String
  rate        Decimal @db.Decimal(5, 4)  // 0.1300
  type        TaxType  // SALES, PURCHASE, WITHHOLDING
  region      String?  // "CN", "US_CA"
  active      Boolean @default(true)
}

enum TaxType {
  SALES
  PURCHASE
  WITHHOLDING
  NONE
}
```

##### 后端逻辑
- ❌ 无税码主数据管理接口
- ❌ 无自动税率查找（基于客户地区、商品类别）
- ❌ 无反算含税价功能
- ❌ 无税务豁免处理

##### 前端配置
- ❌ 无税码配置管理界面
- ❌ 订单表单无法选择税率

#### 影响范围
- 🌍 **无法多地区运营**: 不同国家税率不同
- ⚖️ **税务合规风险**: 固定 13% 不符合实际业务
- 💸 **含税/未税混乱**: 缺少统一的税额计算标准

#### 推荐行动
**优先级**: P0 - 必须修复
**预计工期**: 1 周
**依赖**: 需同步改造 Order、Invoice、Finance 模块

---

### 🔴 3. 库存单据头与出库流程（Stock Picking & Fulfillment）

**问题严重性**: ⚠️ **物流执行缺失** - 有订单但无法正确发货

#### 组件状态（已更新 2026-05-05）

##### 数据库层
```prisma
// ❌ 以下模型不存在

model StockPicking {
  // 出入库单据头（发货单/收货单）
  id           String       @id
  type         PickingType  // OUTBOUND, INBOUND, INTERNAL
  orderId      String?      // 关联销售/采购订单
  status       PickingStatus
  moves        StockMove[]
}

model StockMove {
  // 库存移动明细（从 A 库位 -> B 库位）
  id              String   @id
  pickingId       String
  productId       String
  fromLocationId  String
  toLocationId    String
  quantity        Decimal
  quantityDone    Decimal  // 实际完成数量
  status          MoveStatus
}

enum PickingType {
  OUTBOUND      // 销售出库
  INBOUND       // 采购入库
  INTERNAL      // 内部调拨
}
```

##### 后端逻辑
- ❌ 无发货单生成接口
- ❌ 无拣货单打印
- ❌ 无批次号扫码绑定
- ❌ 无波次管理（Wave Management）

##### 前端界面
- ❌ 无发货执行工作台
- ❌ 无扫码枪集成（条码监听器）

#### 当前变通方案问题

现在的代码在 `orders.service.ts` 直接修改 `StockQuant.quantity`：

```typescript
// ⚠️ 简化处理，缺少单据留痕
await this.prisma.stockQuant.update({
  where: { id: quant.id },
  data: { quantity: { decrement: lineItem.quantity } }
});
```

**问题**:
- 📝 无出库单据可追溯
- 🚫 无法支持"分批发货"
- ⚠️ 无实物盘点对账依据

#### 推荐行动
**优先级**: P0 - 核心流程
**预计工期**: 2 周
**依赖**: 需配合 Order 发货逻辑重构

---

### 🔴 4. 库存安全防护机制（Inventory Safety Guards）

**问题严重性**: ⚠️ **数据一致性风险** - 并发场景可能超卖或负库存

#### 当前存在的隐患

##### 问题 1: 缺少库存预留（Stock Reservation）

在 `orders.service.ts:155-169` 的扣减库存逻辑：

```typescript
// ⚠️ 问题：订单创建时未预留库存
// 如果订单确认到发货之间时间较长，其他订单可能抢占库存
const quant = await this.prisma.stockQuant.findFirst({
  where: {
    productId: lineItem.productId,
    quantity: { gte: lineItem.quantity }
  }
});

if (!quant) {
  throw new ConflictException('库存不足');
}
```

**正确做法应该是**:
```typescript
// ✅ 订单确认时预留，发货时扣减
model StockQuant {
  quantity          Decimal  // 实物数量
  reservedQuantity  Decimal  // 已预留数量
  availableQuantity Decimal  // 可用 = 实物 - 预留
}
```

##### 问题 2: 缺少并发保护（Concurrency Control）

当前代码：
```typescript
// ❌ 先查后改，存在 Race Condition
const quant = await findFirst(...);
await update({ where: { id: quant.id }, data: { quantity: newQty } });
```

高并发场景下，两个请求可能同时读到 `quantity=10`，都认为足够，结果扣成负数。

**正确做法**:
```typescript
// ✅ 使用 WHERE 条件保证原子性
const result = await this.prisma.stockQuant.updateMany({
  where: {
    id: quantId,
    quantity: { gte: decrementAmount }  // 乐观锁断言
  },
  data: { quantity: { decrement: decrementAmount } }
});

if (result.count === 0) {
  throw new ConflictException('库存不足或已被其他订单占用');
}
```

##### 问题 3: 缺少成本计价方法

- ❌ 无 FIFO（先进先出）
- ❌ 无 LIFO（后进先出）
- ❌ 无移动加权平均
- ⚠️ 当前 `StockQuant` 无 `costPrice` 字段

#### 推荐行动
**优先级**: P0 - 数据安全
**预计工期**: 1 周
**方案**:
1. 添加 `reservedQuantity` 字段
2. 改造所有库存变动为原子操作
3. 引入成本核算层

---

## 二、中优先级缺失功能 (P1 - 重要但非阻塞)

### 🟡 1. 多币种支持（Multi-Currency）

#### 缺失内容
- ❌ 无 `Currency` 模型
- ❌ 无 `ExchangeRate` 汇率表
- ❌ 订单、发票无 `currencyId` 字段
- ❌ 无汇兑损益自动记账

#### 影响
- 🌏 无法支持跨境贸易
- 💱 外币交易无法记录

#### 推荐行动
**优先级**: P1
**预计工期**: 1 周

---

### 🟡 2. 高级数据网格（Advanced Data Grid）

#### 规划已完成但未实现

在 `docs/plans/EXECUTION_PLAN.md` 明确提到：

> 引入 AG Grid 或 TanStack Table v8，支持：
> - 行内编辑 (Inline Cell Editing)
> - 虚拟滚动 (Virtual Scrolling)
> - 用户自定义列

#### 当前状态
- ✅ TanStack Table 已引入
- ❌ **无行内编辑功能**
- ❌ 无虚拟滚动（大数据集会卡顿）
- ❌ 无列偏好持久化
- ❌ 无吸顶操作栏（Sticky Action Bar）

#### 影响
- 📊 数据密集型页面（如订单明细录入）体验差
- 🖱️ 每次修改都要弹窗，效率低

#### 推荐行动
**优先级**: P1 - 用户体验
**预计工期**: 1 周

---

### 🟡 3. PostgreSQL 行级安全（RLS - Row Level Security）

#### 当前安全隐患

虽然已有 `TenantContextMiddleware`，但仅在应用层过滤：

```typescript
// apps/api/src/core/tenant/tenant-context.middleware.ts
// ⚠️ 应用层控制，不是物理隔离
req.tenantContext = { companyId: user.companyId };
```

**风险**:
- 如果开发者忘记在 Prisma 查询中加 `where: { companyId }`，会导致数据越权
- 原始 SQL 查询可能绕过中间件

#### 推荐方案

在 PostgreSQL 启用 RLS：

```sql
-- 为每张表启用 RLS
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;

-- 创建策略
CREATE POLICY tenant_isolation ON "Order"
  USING (company_id = current_setting('app.current_tenant')::text);
```

配合 Prisma Middleware 自动注入租户上下文：

```typescript
prisma.$use(async (params, next) => {
  await prisma.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
  return next(params);
});
```

#### 推荐行动
**优先级**: P1 - 安全加固
**预计工期**: 3 天

---

## 三、部分实现功能的缺口

### ⚠️ 1. 工作流引擎（Workflow Engine）

#### 已实现
- ✅ 基础状态跃迁 (`DRAFT -> CONFIRMED -> SHIPPED`)
- ✅ 事件触发器 (`workflow.action.sale_order.shipped`)

#### 缺失
- ❌ 无动态流程定义（目前写死在代码里）
- ❌ 无条件分支（例如：金额 > 10万需要总监审批）
- ❌ 无审批链路可视化
- ❌ 无回退/驳回功能
- ❌ 审计日志不完整（缺少操作人、时间戳详情）

#### 建议
引入 `WorkflowDefinition` 模型，支持低代码配置工作流。

---

### ⚠️ 2. 财务模块（Finance Module）

#### 已实现
- ✅ 科目表 (`ChartOfAccount`)
- ✅ 会计分录 (`JournalEntry` + `JournalEntryLine`)
- ✅ 借贷平衡校验

#### 缺失
- ❌ 无试算平衡表（Trial Balance）
- ❌ 无期末结账（Period Closing）
- ❌ 无损益表（P&L Statement）
- ❌ 无资产负债表（Balance Sheet）
- ❌ 无现金流量表（Cash Flow Statement）
- ❌ 调整分录（Adjustment Entry）功能不完整

#### 建议
先完成报表生成器，再考虑自动化结账流程。

---

### ✅ 3. AI 功能集成（AI Features）— 核心逻辑已落地

#### 已实现（后端核心 + 前端 UI）
- ✅ Command Palette 界面（apps/web/src/components/ai/CommandPalette.tsx） (`apps/web/src/components/ai/CommandPalette.tsx`)
- ✅ Chat2DashPanel 组件
- ✅ DocumentDraftUploader（OCR 上传器）

#### 已实现（核心逻辑，2026-05-05 更新）
- ✅ **LLM 接入已完成** — `LlmAdapterService` 已实现 OpenAI Function Calling
- ✅ **Function Calling 已实现** — 支持 create_resource / transition_workflow / chat2dash_query / chat2sql_read / parse_document_draft
- ✅ **Chat2SQL 已实现** — AIService.chat2sql() + LlmAdapterService.resolveReadSql() 支持只读 SELECT 查询
- ⚠️ **文档解析部分实现** — 文件名推测 + LLM 降级兜底，尚无真实 OCR

#### 代码证据（已更新 2026-05-05）

pps/api/src/core/ai/llm-adapter.service.ts — 完整实现：
- esolveToolCall() — OpenAI Function Calling 路由
- esolveReadSql() — SQL 只读查询生成（限定 SELECT + companyId 过滤）
- esolveDocumentDraft() — 文档草稿 JSON 生成

pps/api/src/core/ai/ai.service.ts — 完整业务逻辑：
- command() — AI 指令路由器（LLM 优先 → 规则引擎兜底）
- chat2dash() — 图表洞察查询
- chat2sql() — 只读 SQL 查询执行
- parseDocumentDraft() — 附件解析
#### 推荐行动
**优先级**: P1
**预计工期**: 2 周
**依赖**: 需选型 LLM 提供商（OpenAI / Azure / 自部署）

---

## 四、完全缺失的功能模块

### ❌ 1. CRM 客户关系管理（P2）

**规划文档**: `README.md:142` 提到 "P2: CRM 线索与商机漏斗"

**缺失内容**:
- 线索（Lead）
- 商机（Opportunity）
- 销售漏斗（Funnel）
- 活动记录（Activity）
- 客户分级（Customer Segmentation）

---

### ❌ 2. HR 与薪资（P2）

**规划文档**: `README.md:143` 提到 "P2: HR/Payroll"

**缺失内容**:
- 员工档案（Employee）
- 考勤打卡（Attendance）
- 请假申请（Leave）
- 薪资计算引擎（Payroll）

---

### ❌ 3. 报表中心（Critical）

**影响**: 📊 **无法进行经营分析**

**缺失报表**:
- 财务三大表（损益表、资产负债表、现金流量表）
- 库存周转率分析
- 销售业绩仪表盘
- 利润中心分析
- 供应商绩效分析

**当前状态**:
- 仅有 Dashboard 页面的简单统计卡片
- 无可交互的图表组件（虽有 `recharts` 依赖但未使用）

---

### ❌ 4. DevOps 与测试

#### CI/CD 状态（已更新 2026-05-05）
- ✅ `.github/workflows/ci.yml` + `deploy.yml` 已落地
- ⚠️ 自动化测试覆盖率待提升
- ⚠️ 部署脚本为占位（deploy.yml），需配置实际服务器

#### 测试覆盖率未知
- 虽有 `.spec.ts` 文件，但不确定是否可运行
- 无集成测试
- 无端到端测试（E2E）

#### 监控与日志
- ❌ 无日志聚合（ELK/Loki）
- ❌ 无性能监控（APM）
- ❌ 无告警系统

---

## 五、架构优势与不足总结

### ✅ 架构亮点

1. **元数据驱动** - 极大减少重复代码
2. **通用 CRUD API** - 新增模型几乎零成本
3. **事件驱动** - 模块解耦良好
4. **多租户设计** - 从第一天就考虑了 SaaS 架构

### ⚠️ 架构短板

1. **业务完整性不足** - 核心流程有断点（尤其采购）
2. **企业级特性缺失** - 税务、多币种、审批流
3. **数据安全防护弱** - 并发控制、RLS 不到位
4. **AI 已部分落地** - Function Calling + Chat2SQL 已实现，OCR 识别待接入真实视觉模型
5. **可观测性缺失** - 无监控、无报表、无审计追溯

---

## 六、推荐实施路线图

### 第 1-2 周：P0 功能补齐（业务闭环）
- [ ] 实现 PurchaseOrder 模块（采购订单 + 收货单）
- [x] 构建可配置税务引擎（TaxCode 主数据 + 动态税率计算） ✅ 已完成
- [ ] 改造库存扣减为原子操作（防并发超卖）

### 第 3-4 周：P0 功能深化（流程完善）
- [ ] 实现 StockPicking/StockMove（出入库单据）
- [ ] 添加库存预留机制（`reservedQuantity`）
- [ ] 完成三单匹配逻辑（PO ↔ GR ↔ Invoice）

### 第 5-6 周：P1 功能提升（用户体验）
- [ ] 高级数据网格（行内编辑、虚拟滚动）
- [ ] 多币种支持（Currency + ExchangeRate）
- [ ] PostgreSQL RLS 安全加固

### 第 7-8 周：AI 功能落地
- [x] 接入 LLM 提供商（OpenAI） ✅ 已完成
- [x] 实现 Function Calling（NL2Action） ✅ 已完成
- [x] 完成 Chat2SQL（Schema 注入 + SQL 生成） ✅ 已完成

### 第 9-10 周：报表与分析
- [ ] 财务三大报表生成器
- [ ] 销售与库存分析仪表盘
- [ ] 可交互式数据探索

### 第 11-12 周：测试与部署
- [ ] 编写集成测试（采购→入库→应付→付款 E2E）
- [x] 搭建 CI/CD 管道 ✅ 已完成
- [ ] 容器化与生产环境部署

---

## 七、关键文件路径索引

### 后端核心
- 数据库模型: `/home/runner/work/OneERP/OneERP/apps/api/prisma/schema.prisma`
- 通用 CRUD: `/home/runner/work/OneERP/OneERP/apps/api/src/core/crud/`
- 工作流引擎: `/home/runner/work/OneERP/OneERP/apps/api/src/core/workflow/`
- 订单服务: `/home/runner/work/OneERP/OneERP/apps/api/src/orders/`
- 财务服务: `/home/runner/work/OneERP/OneERP/apps/api/src/finance/`

### 前端核心
- 动态引擎: `/home/runner/work/OneERP/OneERP/apps/web/src/components/dynamic/`
- AI 组件: `/home/runner/work/OneERP/OneERP/apps/web/src/components/ai/`
- 页面路由: `/home/runner/work/OneERP/OneERP/apps/web/src/app/`

### 规划文档
- 项目计划: `/home/runner/work/OneERP/OneERP/docs/plans/PROJECT_PLAN_AND_STATUS.md`
- 执行计划: `/home/runner/work/OneERP/OneERP/docs/plans/EXECUTION_PLAN.md`
- 核心模块开发计划: `/home/runner/work/OneERP/OneERP/docs/plans/CORE_MODULES_DEV_PLAN.md`

---

## 八、结论

OneERP 项目的**技术架构设计优秀**，元数据驱动和事件驱动的理念非常先进，但**业务模块实现进度约 50%**。

**最紧急的任务是补齐采购模块和税务引擎**，这两个是企业 ERP 的核心刚需，否则系统无法投入实际使用。

其次是**库存安全加固**和**Stock Picking 流程**，防止数据不一致和业务断链。

AI 功能核心逻辑已落地（LLM Function Calling + Chat2SQL + 规则引擎兜底），但需要配置 OPENAI_API_KEY 才能启用 LLM 路由；未配置时自动降级为规则引擎。

报表系统完全缺失，建议在完成核心业务流后优先开发财务三表和销售分析看板。

---

**生成工具**: Claude Code Agent
**分析基准**: 完整代码库扫描 + 规划文档对比
**建议审阅人**: 后端架构师、业务分析师、项目经理
