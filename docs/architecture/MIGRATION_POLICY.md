# 🗄️ OneERP Migration Policy (迁移策略)

> 最后更新：2026-05-05 · 版本：1.0.0
> 维护人：项目总结构师

---

## 1. 核心原则

### 🚨 铁律：禁止手改历史 migration

> **`apps/api/prisma/migrations/` 目录下的所有文件均为 `npx prisma migrate dev` 自动生成。**
> **任何手动修改历史 migration SQL 文件的行为均被严格禁止。**

原因：
1. 历史 migration 已在生产数据库执行过，手动修改会导致 `prisma migrate deploy` 检测到校验和不匹配而失败
2. 开发环境与生产环境的数据库 schema 将出现不可控偏差
3. 团队成员无法通过 migration 历史追溯真实的 schema 变更

### 当前 migration 清单

| Migration                                    | 说明                   |
| -------------------------------------------- | ---------------------- |
| `20260321130503_init`                        | 初始 schema            |
| `20260323103803_phase2_stock_location_autopost` | 库存自动过账         |
| `20260323103811_rewrite_baseline`            | 基线重写               |
| `20260326070735_stock_location_parent_tree`  | 库位树形结构           |
| `20260505083000_taxcode_engine`              | 税码引擎               |

---

## 2. 新增字段标准流程

### 2.1 新增可选字段（无历史数据回填需求）

```bash
# 1. 修改 schema.prisma，添加字段（必须有默认值或允许 null）
# model Order {
#   notes  String?   // 新增可选字段
# }

# 2. 本地生成 migration
cd apps/api
npx prisma migrate dev --name add_order_notes

# 3. 验证
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run test

# 4. 提交 migration 目录和 schema 变更
git add prisma/schema.prisma prisma/migrations/20XXXXXX_add_order_notes/
git commit -m "chore(prisma): add Order.notes optional field"
```

### 2.2 新增必填字段（需要历史数据回填）

当新字段为 `NOT NULL` 且无默认值时，必须分两步操作：

**Step 1: 添加可选字段 + 回填脚本**

```bash
# 1. schema.prisma 先添加为可选字段
# model Order {
#   priority  Int?   // 先用可选字段
# }

# 2. 生成 migration
npx prisma migrate dev --name add_order_priority_nullable

# 3. 编写回填脚本 (scripts/backfill-order-priority.ts)
#    - 按公司分批处理，每批 100 条
#    - 使用 UPDATE ... SET priority = <default> WHERE priority IS NULL
#    - 输出处理进度和总数

# 4. 提交并部署 Step 1
```

**Step 2: 将字段改为必填**

```bash
# 1. 确认回填脚本已在所有环境执行完毕

# 2. schema.prisma 改为必填
# model Order {
#   priority  Int   @default(0)
# }

# 3. 生成新 migration
npx prisma migrate dev --name make_order_priority_required

# 4. 提交并部署 Step 2
```

### 2.3 回填脚本规范

所有回填脚本必须放在 `apps/api/scripts/` 目录下，命名格式：

```
backfill-{model}-{field}.ts
```

脚本必须遵守以下规范：

```typescript
// scripts/backfill-order-priority.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BATCH_SIZE = 100;

async function main() {
  let totalUpdated = 0;
  let hasMore = true;

  while (hasMore) {
    const result = await prisma.$executeRaw`
      UPDATE "Order"
      SET "priority" = 0
      WHERE "priority" IS NULL
      AND "id" IN (
        SELECT "id" FROM "Order"
        WHERE "priority" IS NULL
        LIMIT ${BATCH_SIZE}
      )
    `;

    totalUpdated += result;
    hasMore = result > 0;
    console.log(`已处理 ${totalUpdated} 条记录`);
  }

  console.log(`回填完成，共更新 ${totalUpdated} 条`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

运行方式：

```bash
npx ts-node scripts/backfill-order-priority.ts
```

---

## 3. Migration 命名规范

格式：`{timestamp}_{description}`

description 使用 snake_case，清晰描述变更内容：

| 示例                                          | 说明               |
| --------------------------------------------- | ------------------ |
| `add_order_notes`                             | 添加字段           |
| `make_order_priority_required`                | 改为必填           |
| `add_index_order_company_status`              | 添加索引           |
| `add_taxcode_engine`                          | 新增表/功能        |
| `fix_stock_quant_unique_constraint`           | 修复约束           |

---

## 4. CI 中的 Migration 策略

### 4.1 CI 流水线 (`ci.yml`)

```yaml
- name: Run Prisma migrations
  run: npx prisma migrate deploy --schema=./prisma/schema.prisma
  working-directory: apps/api
```

CI 使用 `prisma migrate deploy`（非 `dev`），只执行未执行过的 migration。

### 4.2 生产部署

```bash
# 在生产服务器上执行
cd apps/api
npx prisma migrate deploy --schema=./prisma/schema.prisma
```

生产环境同样使用 `deploy` 命令，不生成新 migration。

---

## 5. Schema 变更审查清单

提交 PR 时，若包含 `schema.prisma` 变更，必须在 PR 描述中回答以下问题：

- [ ] 新字段是否有默认值？如果没有，回填策略是什么？
- [ ] 是否有索引变更？对查询性能影响如何？
- [ ] 是否有唯一约束变更？是否可能导致现有数据冲突？
- [ ] 是否有外键变更？是否有级联删除风险？
- [ ] 回填脚本是否已编写并测试？
- [ ] 是否需要分步部署（先加可选字段 → 回填 → 改必填）？

---

## 6. 紧急修复流程

当生产环境出现 migration 问题时：

1. **禁止**手动修改任何 migration 文件
2. 使用 `npx prisma migrate resolve` 标记有问题的 migration
3. 编写新的修复 migration
4. 通过正常 PR 流程提交

```bash
# 标记为已回滚
npx prisma migrate resolve --rolled-back 20XXXXXX_problematic_migration

# 或标记为已应用
npx prisma migrate resolve --applied 20XXXXXX_problematic_migration
```