import { AsyncLocalStorage } from 'node:async_hooks';

interface TenantStore {
  companyId?: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<TenantStore>();

export class TenantContext {
  static run<T>(store: TenantStore, callback: () => T): T {
    return storage.run(store, callback);
  }

  static hasStore() {
    return Boolean(storage.getStore());
  }

  static getCompanyId() {
    return storage.getStore()?.companyId;
  }

  static getUserId() {
    return storage.getStore()?.userId;
  }
}
