import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Carries the current request's tenant (store) id across the async call stack so the
 * Prisma tenant-scoping middleware (lib/prisma.ts) can read it without every service
 * function threading storeId through by hand. Set once, at the top of the request
 * pipeline, by middleware/tenantContext.middleware.ts.
 */
interface TenantContextStore {
  tenantId: string;
}

const storage = new AsyncLocalStorage<TenantContextStore>();

export const tenantContext = {
  run<T>(tenantId: string, fn: () => T): T {
    return storage.run({ tenantId }, fn);
  },
  getTenantId(): string | undefined {
    return storage.getStore()?.tenantId;
  },
};
