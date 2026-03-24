import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { TenantContext } from '../tenant/tenant-context';

interface ERPDatabase {
  [table: string]: Record<string, unknown>;
}

@Injectable()
export class KyselyService implements OnModuleDestroy {
  readonly db: Kysely<ERPDatabase>;
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL 未配置，无法初始化 Kysely');
    }

    this.pool = new Pool({ 
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
    });

    this.db = new Kysely<ERPDatabase>({
      dialect: new PostgresDialect({
        pool: this.pool,
      }),
    });
  }

  async withTenant<T>(callback: (trx: Kysely<ERPDatabase>) => Promise<T>): Promise<T> {
    const companyId = TenantContext.getCompanyId();
    if (!companyId) {
      throw new Error('租户上下文缺失，Kysely 查询已阻止');
    }

    return await this.db.transaction().execute(async (trx) => {
      await sql`SELECT set_config('app.current_tenant', ${companyId}, true)`.execute(trx);
      return await callback(trx as unknown as Kysely<ERPDatabase>);
    });
  }

  async onModuleDestroy() {
    await this.db.destroy();
  }
}