# OneERP 安全运行手册

> **最后更新**: 2026-05-07
> **维护者**: Core Team / 安全负责人
> **关联文档**: [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) · [QUALITY_GATES.md](../architecture/QUALITY_GATES.md)

---

## 1. Chat2SQL 安全策略

### 1.1 当前实现

Chat2SQL 已从 `$queryRawUnsafe`（原始 SQL 执行）重构为 **SafeChat2SqlService**，使用 Prisma ORM 结构化查询。

**安全机制**：
- **模型白名单**：仅允许查询 `order`、`invoice`、`partner`、`material`、`inventoryTransaction`、`purchaseOrder`、`goodsReceipt`
- **字段白名单**：每个模型仅允许特定字段用于分组（`groupableFields`）和聚合（`aggregatableFields`）
- **强制 companyId 注入**：所有查询自动注入 `companyId` 过滤，防止跨租户越权
- **无 SQL 执行**：不使用 `$queryRawUnsafe`，完全通过 Prisma ORM 代理

**旧实现状态**：
- `ENABLE_UNSAFE_CHAT2SQL` 环境变量控制的旧 SQL 执行路径仍保留在代码中，但默认关闭
- 计划在未来版本中完全移除

### 1.2 新增模型时的安全检查

当添加新的可查询模型时，必须：

1. 在 `SafeChat2SqlService` 的 `ALLOWED_MODELS` 中注册模型
2. 明确指定 `groupableFields`、`aggregatableFields`、`filterableFields`
3. 确保模型在 `PrismaService` 的 `COMPANY_SCOPED_MODELS` 中注册（如需租户隔离）
4. 添加对应的关键词映射到 `getFieldKeywords()`

### 1.3 已知限制

- 关键词匹配无法覆盖所有自然语言表述
- 聚合查询仅支持 count/sum/avg，不支持复杂统计
- 时间过滤仅支持相对时间（今天/本周/本月/最近N天），不支持绝对日期

---

## 2. JWT 与认证安全

### 2.1 当前配置

- **Access Token 有效期**: 7 天（`expiresIn: '7d'`）
- **签名算法**: HS256（`JWT_SECRET` 环境变量）
- **Refresh Token**: 未实现（计划中）

### 2.2 安全建议

- **生产环境**必须设置强随机 `JWT_SECRET`（≥32 字符）
- Access Token 应缩短至 15-30 分钟，配合 Refresh Token 使用
- Refresh Token 应存储在 HttpOnly Cookie 中，支持服务端撤销

### 2.3 计划改进

| 项目 | 状态 | 优先级 |
|------|------|--------|
| Access Token 缩短有效期 | 待实现 | P1 |
| Refresh Token 机制 | 待实现 | P1 |
| Token 黑名单/撤销 | 待实现 | P2 |

---

## 3. CORS 与 CSP 策略

### 3.1 当前配置

- **CORS**: 允许 localhost:3000（开发环境）
- **CSP connect-src**: 前端通过 `/api/proxy` 同源代理访问后端，避免 CSP 限制

### 3.2 生产环境要求

- 必须配置精确的 CORS `origin` 白名单
- CSP 应限制 `connect-src` 仅允许已知域名
- 避免使用 `*` 通配符

---

## 4. 多租户隔离

### 4.1 实现机制

- **AsyncLocalStorage**: `TenantContext` 通过 `AsyncLocalStorage` 绑定租户上下文
- **Prisma 中间件**: `COMPANY_SCOPED_MODELS` 中的模型自动注入 `companyId` 到 where/create 子句
- **TenantGuard**: 请求级守卫，验证用户在目标公司有 `UserCompanyRole` 记录

### 4.2 新增模型时的租户隔离检查

1. 如果模型有 `companyId` 字段且需要租户隔离：
   - 在 `COMPANY_SCOPED_MODELS` 中注册模型名（PascalCase）
2. 如果模型没有 `companyId`（如子表通过父表关联）：
   - 不要在 `COMPANY_SCOPED_MODELS` 中注册（会导致 500 错误）
   - 通过父表的租户隔离间接保护

### 4.3 已知风险

- 子表（如 `StockQuant`、`OrderItem`）如果直接通过 CRUD 访问，可能绕过租户隔离
- 建议：子表查询应通过父表 include，而非直接 CRUD

---

## 5. 依赖安全

### 5.1 当前状态

GitHub Dependabot 报告 71 个漏洞：
- 1 个 Critical
- 26 个 High
- 41 个 Moderate
- 3 个 Low

### 5.2 处理优先级

1. **Critical/High**: 立即评估并升级
2. **Moderate**: 排入迭代计划
3. **Low**: 定期清理

### 5.3 检查命令

```bash
npm audit
npm audit fix --dry-run
```

---

## 6. 安全事件响应

### 6.1 发现跨租户越权

1. 立即检查 `TenantGuard` 和 `COMPANY_SCOPED_MODELS` 配置
2. 确认相关模型在 Prisma 中间件中有正确隔离
3. 检查是否有直接 `$queryRawUnsafe` 调用绕过租户过滤
4. 修复后验证：用不同公司的 token 访问，确认数据不可见

### 6.2 发现 SQL 注入

1. 搜索代码中的 `$queryRawUnsafe` 和 `$executeRawUnsafe`
2. 确认所有原始 SQL 都有参数化处理
3. 优先替换为 Prisma ORM 查询
4. 如必须使用原始 SQL，使用 `$queryRaw` + Prisma.sql 模板字面量

---

## 7. 安全检查清单（CI/CD 集成）

每次 PR 合并前确认：

- [ ] 新增模型已在 `COMPANY_SCOPED_MODELS` 中注册（如需租户隔离）
- [ ] 新增 Chat2SQL 可查询模型已在 `ALLOWED_MODELS` 白名单中
- [ ] 无新的 `$queryRawUnsafe` 调用
- [ ] JWT_SECRET 未硬编码在代码中
- [ ] 敏感字段（passwordHash 等）未暴露到 API 响应

---

**文档维护说明**: 安全策略变更时必须同步更新本文档。重大安全决策请在 `docs/plans/` 中记录。