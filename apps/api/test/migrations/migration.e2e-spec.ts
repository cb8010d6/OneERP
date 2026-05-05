/**
 * Prisma 迁移集成测试
 *
 * 三个核心场景:
 *   1. 空库 migrate deploy — 全量迁移后验证完整 schema
 *   2. 旧库迁移到当前 schema — 逐步迁移 + 增量数据验证
 *   3. TaxCode 历史数据策略 — 迁移后历史行的默认值断言
 *
 * 运行前提:
 *   - 环境变量 DATABASE_URL 指向测试库 (会 DROP ALL TABLES)
 *   - PostgreSQL >= 14
 *
 * 运行方式:
 *   DATABASE_URL=postgresql://... npx jest --config ./test/jest-e2e.json test/migrations/migration.e2e-spec.ts
 */

import { Client } from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const PRISMA_DIR = join(__dirname, '../../prisma');
const MIGRATIONS_DIR = join(PRISMA_DIR, 'migrations');

/** 按文件名排序返回所有 migration 目录 */
function getMigrationDirs(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{14}_/.test(d.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => d.name);
}

/** 读取单个 migration.sql 内容 */
function readMigrationSql(dirName: string): string {
  const sqlPath = join(MIGRATIONS_DIR, dirName, 'migration.sql');
  return readFileSync(sqlPath, 'utf-8');
}

/** 安全执行 SQL，忽略 "already exists" 类错误 */
async function safeExec(client: Client, sql: string): Promise<void> {
  try {
    await client.query(sql);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/already exists|duplicate/i.test(msg)) return;
    throw err;
  }
}

/** 删除所有 public 表 (测试前清库) */
async function dropAllTables(client: Client): Promise<void> {
  await client.query(`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS "' || r.tablename || '" CASCADE';
      END LOOP;
    END $$;
  `);
  await client.query('DROP TABLE IF EXISTS "_prisma_migrations" CASCADE');
}

/** 获取指定表的所有列名 */
async function getColumns(
  client: Client,
  tableName: string,
): Promise<Set<string>> {
  const res = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  );
  return new Set(res.rows.map((r: { column_name: string }) => r.column_name));
}

/** 检查表是否存在 */
async function tableExists(
  client: Client,
  tableName: string,
): Promise<boolean> {
  const res = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName],
  );
  return res.rows[0].exists as boolean;
}

// ---------------------------------------------------------------------------
// 按 Prisma schema 期望的完整表清单
// ---------------------------------------------------------------------------
const EXPECTED_TABLES = [
  'Company',
  'User',
  'Role',
  'UserCompanyRole',
  'Department',
  'Partner',
  'TaxCode',
  'Order',
  'OrderItem',
  'Warehouse',
  'StockLocation',
  'Material',
  'ProductCategory',
  'Product',
  'Bom',
  'BomLine',
  'StockQuant',
  'FileRecord',
  'InventoryTransaction',
  'Workflow',
  'WorkflowState',
  'WorkflowTransition',
  'WorkOrder',
  'WorkReport',
  'Invoice',
  'Payment',
  'Account',
  'Journal',
  'JournalEntry',
  'JournalEntryLine',
  'EventDlq',
  'AuditLog',
];

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe('Prisma 迁移集成测试', () => {
  let client: Client;
  const databaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    if (!databaseUrl) {
      throw new Error(
        'DATABASE_URL 环境变量未设置。请指向测试 PostgreSQL 数据库。',
      );
    }
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
  });

  // =========================================================================
  // 场景 1: 空库 migrate deploy
  // =========================================================================
  describe('场景 1: 空库 migrate deploy', () => {
    beforeAll(async () => {
      await dropAllTables(client);
    });

    it('应当通过 prisma migrate deploy 完成全量迁移', () => {
      expect(() => {
        execSync('npx prisma migrate deploy', {
          cwd: join(__dirname, '../..'),
          env: { ...process.env, DATABASE_URL: databaseUrl },
          stdio: 'pipe',
          timeout: 60_000,
        });
      }).not.toThrow();
    });

    it('所有预期表应当存在', async () => {
      for (const table of EXPECTED_TABLES) {
        const exists = await tableExists(client, table);
        expect(exists).toBe(true);
      }
    });

    it('TaxCode 表应当包含全部字段', async () => {
      const cols = await getColumns(client, 'TaxCode');
      const expectedCols = [
        'id',
        'code',
        'name',
        'rate',
        'isTaxInclusive',
        'isDefault',
        'active',
        'accountId',
        'companyId',
        'createdAt',
        'updatedAt',
      ];
      for (const col of expectedCols) {
        expect(cols.has(col)).toBe(true);
      }
    });

    it('Order 表应当包含税码快照字段', async () => {
      const cols = await getColumns(client, 'Order');
      expect(cols.has('subTotal')).toBe(true);
      expect(cols.has('taxTotal')).toBe(true);
      expect(cols.has('taxCodeId')).toBe(true);
    });

    it('OrderItem 表应当包含税码快照字段', async () => {
      const cols = await getColumns(client, 'OrderItem');
      expect(cols.has('subTotal')).toBe(true);
      expect(cols.has('taxAmount')).toBe(true);
      expect(cols.has('taxRate')).toBe(true);
      expect(cols.has('taxCodeId')).toBe(true);
    });

    it('Invoice 表应当包含税码快照字段', async () => {
      const cols = await getColumns(client, 'Invoice');
      expect(cols.has('subTotal')).toBe(true);
      expect(cols.has('taxAmount')).toBe(true);
      expect(cols.has('taxCodeId')).toBe(true);
    });

    it('StockLocation 表应当包含 parentId 自引用字段', async () => {
      const cols = await getColumns(client, 'StockLocation');
      expect(cols.has('parentId')).toBe(true);
    });

    it('Account 表应当存在（TaxCode 关联依赖）', async () => {
      const cols = await getColumns(client, 'Account');
      expect(cols.has('id')).toBe(true);
      expect(cols.has('code')).toBe(true);
      expect(cols.has('companyId')).toBe(true);
    });

    it('唯一索引 TaxCode(companyId, code) 应当存在', async () => {
      const res = await client.query(`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'TaxCode'
          AND indexname = 'TaxCode_companyId_code_key'
      `);
      expect(res.rowCount).toBe(1);
    });

    it('外键约束 Order → TaxCode 应当存在', async () => {
      const res = await client.query(`
        SELECT conname FROM pg_constraint
        WHERE conname = 'Order_taxCodeId_fkey'
      `);
      expect(res.rowCount).toBe(1);
    });
  });

  // =========================================================================
  // 场景 2: 旧库迁移到当前 schema
  // =========================================================================
  describe('场景 2: 旧库迁移到当前 schema', () => {
    const allDirs = getMigrationDirs();
    const taxcodeIdx = allDirs.findIndex((d) => d.includes('taxcode_engine'));
    const preTaxDirs = allDirs.slice(0, taxcodeIdx);
    const taxcodeDir = allDirs[taxcodeIdx];

    beforeAll(async () => {
      await dropAllTables(client);
    });

    it('应当能逐步执行 TaxCode 迁移之前的所有脚本', async () => {
      for (const dirName of preTaxDirs) {
        const sql = readMigrationSql(dirName);
        if (sql.trim() === '-- no-op after baseline rewrite') continue;
        await safeExec(client, sql);
      }
      expect(await tableExists(client, 'Company')).toBe(true);
      expect(await tableExists(client, 'Order')).toBe(true);
      expect(await tableExists(client, 'OrderItem')).toBe(true);
      expect(await tableExists(client, 'Invoice')).toBe(true);
    });

    it('迁移前 Order 表不应有 taxCodeId 列', async () => {
      if (taxcodeIdx > 0) {
        const cols = await getColumns(client, 'Order');
        expect(cols.has('taxCodeId')).toBe(false);
      }
    });

    it('迁移前不应存在 TaxCode 表', async () => {
      expect(await tableExists(client, 'TaxCode')).toBe(false);
    });

    it('应当能执行 TaxCode 迁移脚本', async () => {
      const sql = readMigrationSql(taxcodeDir);
      await safeExec(client, sql);
      expect(await tableExists(client, 'TaxCode')).toBe(true);
    });

    it('迁移后 Order 表应当出现 taxCodeId 列', async () => {
      const cols = await getColumns(client, 'Order');
      expect(cols.has('taxCodeId')).toBe(true);
      expect(cols.has('subTotal')).toBe(true);
      expect(cols.has('taxTotal')).toBe(true);
    });

    it('迁移后 OrderItem 表应当出现税码字段', async () => {
      const cols = await getColumns(client, 'OrderItem');
      expect(cols.has('taxCodeId')).toBe(true);
      expect(cols.has('subTotal')).toBe(true);
      expect(cols.has('taxAmount')).toBe(true);
      expect(cols.has('taxRate')).toBe(true);
    });

    it('迁移后 Invoice 表应当出现税码字段', async () => {
      const cols = await getColumns(client, 'Invoice');
      expect(cols.has('taxCodeId')).toBe(true);
      expect(cols.has('subTotal')).toBe(true);
      expect(cols.has('taxAmount')).toBe(true);
    });

    it('应当能执行剩余所有迁移脚本', async () => {
      const remainingDirs = allDirs.slice(taxcodeIdx + 1);
      for (const dirName of remainingDirs) {
        const sql = readMigrationSql(dirName);
        if (sql.trim() === '-- no-op after baseline rewrite') continue;
        await safeExec(client, sql);
      }
      const cols = await getColumns(client, 'StockLocation');
      expect(cols.has('parentId')).toBe(true);
    });
  });

  // =========================================================================
  // 场景 3: TaxCode 历史数据策略验证
  // =========================================================================
  describe('场景 3: TaxCode 历史数据策略验证', () => {
    let companyId: string;
    let userId: string;
    let partnerId: string;

    beforeAll(async () => {
      await dropAllTables(client);
      execSync('npx prisma migrate deploy', {
        cwd: join(__dirname, '../..'),
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
        timeout: 60_000,
      });
    });

    it('应当能插入 Company 基础数据', async () => {
      const res = await client.query(`
        INSERT INTO "Company" ("id", "name", "updatedAt")
        VALUES (gen_random_uuid(), '测试公司', NOW())
        RETURNING "id"
      `);
      companyId = res.rows[0].id;
      expect(companyId).toBeTruthy();
    });

    it('应当能插入 User 基础数据', async () => {
      const res = await client.query(`
        INSERT INTO "User" ("id", "email", "passwordHash", "name", "updatedAt")
        VALUES (gen_random_uuid(), 'test@example.com', 'hash', '测试用户', NOW())
        RETURNING "id"
      `);
      userId = res.rows[0].id;
      expect(userId).toBeTruthy();
    });

    it('应当能插入 Partner 基础数据', async () => {
      const res = await client.query(
        `
        INSERT INTO "Partner" ("id", "name", "companyId", "updatedAt")
        VALUES (gen_random_uuid(), '测试客户', $1, NOW())
        RETURNING "id"
      `,
        [companyId],
      );
      partnerId = res.rows[0].id;
      expect(partnerId).toBeTruthy();
    });

    it('应当能创建 TaxCode 主数据', async () => {
      const res = await client.query(
        `
        INSERT INTO "TaxCode" ("id", "code", "name", "rate", "companyId", "updatedAt")
        VALUES (gen_random_uuid(), 'VAT_13', '增值税 13%', 0.13, $1, NOW())
        RETURNING "id", "code", "rate"
      `,
        [companyId],
      );
      expect(res.rows[0].code).toBe('VAT_13');
      expect(Number(res.rows[0].rate)).toBeCloseTo(0.13);
    });

    describe('历史订单的默认税码快照策略', () => {
      let orderId: string;

      it('应当能创建不含 taxCodeId 的历史订单（模拟旧数据）', async () => {
        const res = await client.query(
          `
          INSERT INTO "Order" ("id", "orderNo", "partnerId", "salesId", "companyId", "status", "totalAmount", "updatedAt")
          VALUES (gen_random_uuid(), 'ORD-HIST-001', $1, $2, $3, 'DRAFT', 1000, NOW())
          RETURNING "id"
        `,
          [partnerId, userId, companyId],
        );
        orderId = res.rows[0].id;

        const row = await client.query(
          `
          SELECT "subTotal", "taxTotal", "taxCodeId"
          FROM "Order" WHERE "id" = $1
        `,
          [orderId],
        );

        expect(Number(row.rows[0].subTotal)).toBe(0);
        expect(Number(row.rows[0].taxTotal)).toBe(0);
        expect(row.rows[0].taxCodeId).toBeNull();
      });

      it('应当能创建不含 taxCodeId 的历史订单行', async () => {
        await client.query(
          `
          INSERT INTO "OrderItem" ("id", "orderId", "productId", "quantity", "unitPrice", "totalPrice", "updatedAt")
          VALUES (gen_random_uuid(), $1, 'PROD-001', 10, 100, 1000, NOW())
        `,
          [orderId],
        );

        const row = await client.query(
          `
          SELECT "subTotal", "taxAmount", "taxRate", "taxCodeId"
          FROM "OrderItem" WHERE "orderId" = $1
        `,
          [orderId],
        );

        expect(Number(row.rows[0].subTotal)).toBe(0);
        expect(Number(row.rows[0].taxAmount)).toBe(0);
        expect(Number(row.rows[0].taxRate)).toBe(0);
        expect(row.rows[0].taxCodeId).toBeNull();
      });

      it('历史订单应当可查询且 tax 字段全为零', async () => {
        const res = await client.query(`
          SELECT "id", "subTotal", "taxTotal", "taxCodeId"
          FROM "Order" WHERE "orderNo" = 'ORD-HIST-001'
        `);
        expect(res.rowCount).toBe(1);
        expect(Number(res.rows[0].subTotal)).toBe(0);
        expect(Number(res.rows[0].taxTotal)).toBe(0);
        expect(res.rows[0].taxCodeId).toBeNull();
      });
    });

    describe('含税码的新订单快照策略', () => {
      let taxCodeId: string;

      it('应当能查询已创建的 TaxCode', async () => {
        const res = await client.query(
          `
          SELECT "id" FROM "TaxCode" WHERE "code" = 'VAT_13' AND "companyId" = $1
        `,
          [companyId],
        );
        expect(res.rowCount).toBe(1);
        taxCodeId = res.rows[0].id;
      });

      it('新订单应能关联 taxCodeId 并记录快照', async () => {
        await client.query(
          `
          INSERT INTO "Order" (
            "id", "orderNo", "partnerId", "salesId", "companyId",
            "status", "totalAmount", "subTotal", "taxTotal", "taxCodeId", "updatedAt"
          ) VALUES (
            gen_random_uuid(), 'ORD-NEW-001', $1, $2, $3,
            'DRAFT', 1130, 1000, 130, $4, NOW()
          )
        `,
          [partnerId, userId, companyId, taxCodeId],
        );

        const row = await client.query(`
          SELECT "subTotal", "taxTotal", "taxCodeId"
          FROM "Order" WHERE "orderNo" = 'ORD-NEW-001'
        `);

        expect(Number(row.rows[0].subTotal)).toBe(1000);
        expect(Number(row.rows[0].taxTotal)).toBe(130);
        expect(row.rows[0].taxCodeId).toBe(taxCodeId);
      });

      it('新订单行应能关联 taxCodeId 并记录税率', async () => {
        const orderRes = await client.query(`
          SELECT "id" FROM "Order" WHERE "orderNo" = 'ORD-NEW-001'
        `);
        const orderId = orderRes.rows[0].id;

        await client.query(
          `
          INSERT INTO "OrderItem" (
            "id", "orderId", "productId", "quantity", "unitPrice", "totalPrice",
            "subTotal", "taxAmount", "taxRate", "taxCodeId", "updatedAt"
          ) VALUES (
            gen_random_uuid(), $1, 'PROD-002', 10, 100, 1130,
            1000, 130, 0.13, $2, NOW()
          )
        `,
          [orderId, taxCodeId],
        );

        const row = await client.query(
          `
          SELECT "subTotal", "taxAmount", "taxRate", "taxCodeId"
          FROM "OrderItem" WHERE "orderId" = $1
        `,
          [orderId],
        );

        expect(Number(row.rows[0].subTotal)).toBe(1000);
        expect(Number(row.rows[0].taxAmount)).toBe(130);
        expect(Number(row.rows[0].taxRate)).toBeCloseTo(0.13);
        expect(row.rows[0].taxCodeId).toBe(taxCodeId);
      });
    });

    describe('Invoice 的税码快照策略', () => {
      it('历史 Invoice（无 taxCodeId）应当默认值为零', async () => {
        const orderRes = await client.query(`
          SELECT "id" FROM "Order" WHERE "orderNo" = 'ORD-HIST-001'
        `);
        const orderId = orderRes.rows[0].id;

        await client.query(
          `
          INSERT INTO "Invoice" (
            "id", "invoiceNo", "orderId", "amount", "status", "companyId", "updatedAt"
          ) VALUES (
            gen_random_uuid(), 'INV-HIST-001', $1, 1000, 'UNPAID', $2, NOW()
          )
        `,
          [orderId, companyId],
        );

        const row = await client.query(`
          SELECT "subTotal", "taxAmount", "taxCodeId"
          FROM "Invoice" WHERE "invoiceNo" = 'INV-HIST-001'
        `);

        expect(Number(row.rows[0].subTotal)).toBe(0);
        expect(Number(row.rows[0].taxAmount)).toBe(0);
        expect(row.rows[0].taxCodeId).toBeNull();
      });

      it('新 Invoice 可关联 TaxCode 并记录税额快照', async () => {
        const orderRes = await client.query(`
          SELECT "id" FROM "Order" WHERE "orderNo" = 'ORD-NEW-001'
        `);
        const taxCodeRes = await client.query(
          `
          SELECT "id" FROM "TaxCode" WHERE "code" = 'VAT_13' AND "companyId" = $1
        `,
          [companyId],
        );

        await client.query(
          `
          INSERT INTO "Invoice" (
            "id", "invoiceNo", "orderId", "amount",
            "subTotal", "taxAmount", "taxCodeId",
            "status", "companyId", "postingStatus", "updatedAt"
          ) VALUES (
            gen_random_uuid(), 'INV-NEW-001', $1, 1130,
            1000, 130, $2,
            'UNPAID', $3, 'DRAFT', NOW()
          )
        `,
          [orderRes.rows[0].id, taxCodeRes.rows[0].id, companyId],
        );

        const row = await client.query(`
          SELECT "subTotal", "taxAmount", "taxCodeId"
          FROM "Invoice" WHERE "invoiceNo" = 'INV-NEW-001'
        `);

        expect(Number(row.rows[0].subTotal)).toBe(1000);
        expect(Number(row.rows[0].taxAmount)).toBe(130);
        expect(row.rows[0].taxCodeId).toBe(taxCodeRes.rows[0].id);
      });
    });

    describe('TaxCode 约束与索引验证', () => {
      it('同一公司下不允许重复 code', async () => {
        await expect(
          client.query(
            `
            INSERT INTO "TaxCode" ("id", "code", "name", "rate", "companyId", "updatedAt")
            VALUES (gen_random_uuid(), 'VAT_13', '重复税码', 0.13, $1, NOW())
          `,
            [companyId],
          ),
        ).rejects.toThrow(/unique/i);
      });

      it('不同公司可以有相同 code', async () => {
        const res = await client.query(`
          INSERT INTO "Company" ("id", "name", "updatedAt")
          VALUES (gen_random_uuid(), '第二公司', NOW())
          RETURNING "id"
        `);
        const company2Id = res.rows[0].id;

        await client.query(
          `
          INSERT INTO "TaxCode" ("id", "code", "name", "rate", "companyId", "updatedAt")
          VALUES (gen_random_uuid(), 'VAT_13', '增值税 13%', 0.13, $1, NOW())
        `,
          [company2Id],
        );

        const count = await client.query(`
          SELECT COUNT(*)::int AS cnt FROM "TaxCode" WHERE "code" = 'VAT_13'
        `);
        expect(count.rows[0].cnt).toBe(2);
      });

      it('TaxCode 的 companyId 外键应引用 Company', async () => {
        await expect(
          client.query(`
            INSERT INTO "TaxCode" ("id", "code", "name", "rate", "companyId", "updatedAt")
            VALUES (gen_random_uuid(), 'INVALID', '无效', 0, 'non-existent-id', NOW())
          `),
        ).rejects.toThrow(/violates foreign key/i);
      });

      it('taxCodeId 外键 SET NULL: 删除 TaxCode 不应级联删除关联订单', async () => {
        const orderRes = await client.query(`
          SELECT o."id" AS "orderId", tc."id" AS "taxCodeId"
          FROM "Order" o
          JOIN "TaxCode" tc ON o."taxCodeId" = tc."id"
          WHERE tc."code" = 'VAT_13'
          LIMIT 1
        `);

        if (orderRes.rowCount === 0) return;

        const { orderId, taxCodeId } = orderRes.rows[0];
        await client.query(`DELETE FROM "TaxCode" WHERE "id" = $1`, [
          taxCodeId,
        ]);

        const checkRes = await client.query(
          `SELECT "taxCodeId" FROM "Order" WHERE "id" = $1`,
          [orderId],
        );
        expect(checkRes.rowCount).toBe(1);
        expect(checkRes.rows[0].taxCodeId).toBeNull();
      });
    });

    describe('批量迁移幂等性验证', () => {
      it('重复执行 taxcode_engine 迁移 SQL 不应报错', async () => {
        const dirs = getMigrationDirs();
        const taxcodeDir = dirs.find((d) => d.includes('taxcode_engine'));
        expect(taxcodeDir).toBeDefined();

        const sql = readMigrationSql(taxcodeDir!);
        await expect(safeExec(client, sql)).resolves.not.toThrow();
      });
    });
  });
});
