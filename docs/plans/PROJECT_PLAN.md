🚀 Next-Gen ERP 核心架构升级计划 (可执行清单)
📍 Phase 1: 夯实动态元数据与扩展机制 (✅ 已完成)
 DB: 核心业务表（Order, Partner 等）增加 customAttributes (JSONB) 预留字段。
 DB: 建立 CustomFieldDefinition 模型，用于存储租户级字段元数据。
 Backend: 在通用 CRUD 引擎中实现 CrudHooksService 生命周期拦截器 (beforeInsert, afterInsert 等)。
 Frontend: 开发 CustomFieldDesigner 组件，实现管理员可视化定义字段。
 Frontend: 升级 DynamicView 引擎（如 FormEngine），支持对 customAttributes 内部字段的动态渲染与双向绑定。

📍 Phase 2: 构建 ERP 的灵魂 —— 复式财务引擎 (✅ 已完成)
 | 目标：实现基于“借贷必相等”的底层凭证系统，并与供应链联动。

2.1 财务底层数据模型设计 (DB Schema)
 ✅ 科目与账簿: 在 prisma.schema 中创建 Account (会计科目表，支持树状结构 parentId)。
 ✅ 日记账: 创建 Journal (日记账类型：如 Cash, Bank, Sales, Purchase)。
 ✅ 凭证主表: 创建 JournalEntry (凭证头部信息，包含 date, ref, journalId)。
 ✅ 凭证明细: 创建 JournalEntryLine (包含 accountId, debit 借方金额, credit 贷方金额, partnerId 辅助核算)。
 ✅ 原子约束: 在 JournalEntry 的层面实现事务锁或数据库校验，强制保证 SUM(debit) == SUM(credit)，不平的账坚决不可入库。
2.2 供应链与财务自动桥接 (Event-Driven)
 ✅ 库存出库凭证: 监听 STOCK_DEPLETED (出库) 事件，自动生成对应的会计凭证（借：主营业务成本，贷：库存商品）。
 ✅ 销售开票凭证: 完善 Invoice 状态机。当发票确认为 POSTED 时，自动生成凭证（借：应收账款，贷：主营业务收入 & 应交税费）。
 ✅ 事件补偿机制: 在 @nestjs/event-emitter 订阅侧增加失败重试或死信队列 (DLQ) 处理，防止财务账与库存账脱节。
📍 Phase 3: All-in 真正的人工智能 (AI Native ERP) (✅ 已完成)
目标：彻底改变交互方式，从依靠鼠标点击升级为 LLM Agent 驱动。

3.1 基于 LLM 的意图路由 (Function Calling)
 ✅ Tools 注册: 基于 NestJS 的通用 CRUD 接口，生成标准的 OpenAPI Specifications 或描述为 AI Tools (如 create_order, get_stock_level)。
 ✅ Chatter 智能体: 将前端的 Chatter 侧边栏对接 LLM (OpenAI/VLLM)，使其不仅能“聊”，还能“做”。
 ✅ 沙盒与确认: NLP 触发写操作前，在前端弹出一个由 AI 生成的 Draft (草稿) 卡片，用户点击“Confirm”后再真正落库，避免 AI 幻觉污染业务数据。
3.2 Chat2SQL 交互式 BI (动态报表)
 ✅ Schema 上下文提取: 编写一个脚本，提取 Prisma Schema 的精简版 DDL (去除与报表无关的字段)。
 ✅ Natural Language 2 Data: 建立数据查询入口，用 system_prompt 限定 AI 只输出安全的 SELECT SQL 或 Prisma Read Query。
 ✅ 动态图表渲染: 前端引入 Tremor 或 Recharts，根据 AI 返回的结构化 JSON 数据，自动选择最合适的图表类型 (Bar, Line, Pie) 渲染。
3.3 多模态单据解析 (OCR + LLM)
 ✅ 发票/收据上传入口: 在财务页面增加上传附件的 Dropzone。
 ✅ 信息提取流水线: 对接具有视觉能力的 LLM (如 GPT-4o 或 Claude 3.5 Sonnet)，提取供应商名称、金额、税率、明细行。
 ✅ 自动填单: 将提取到的 JSON 自动填入已有的 FormEngine，作为不可直接生效的 Draft，由用户校验后保存。
📍 Phase 4: 前端极致体验优化 (✅ 已完成)
难度：⭐⭐⭐ | 目标：秒开、流畅、盲打级效率。

 ✅ 全局 Command Palette: 引入 Cmd+K 快捷键，支持全系统的快速指令执行。
 ✅ 乐观更新 (Optimistic UI): 在状态流转中加入乐观更新与失败回滚。
 ✅ 快捷键绑定 (Keyboard-First): FormEngine 支持 Ctrl+Enter 快速保存表单。
