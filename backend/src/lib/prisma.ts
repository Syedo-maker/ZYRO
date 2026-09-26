import { PrismaClient } from "@prisma/client";
import { tenantContext } from "./tenantContext";

/**
 * Models that carry a `tenantId` column (Phase 0 Module 1 schema). Every one of these
 * must be scoped to the current request's tenant on every read/write; this is the
 * Postgres-side counterpart to the Mongoose `tenantScopePlugin` from the MongoDB models.
 */
const TENANT_SCOPED_MODELS = new Set([
  "StaffMember",
  "Location",
  "InventoryLevel",
  "StockMovement",
  "Customer",
  "CheckoutSession",
  "Refund",
  "PosShift",
  "OrderReturn",
  "HeldSale",
  "Order",
  "Payment",
  "Shipment",
  "ShippingZone",
  "DiscountCode",
  "AiUsageQuota",
  "CartRecoveryEvent",
  "AiBusinessInsight",
  "AiTopUpPurchase",
]);

// Operations where merging `{ tenantId }` into `where`/`data` is safe and sufficient.
const WHERE_OPERATIONS = new Set(["findMany", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy", "updateMany", "deleteMany"]);
const DATA_OPERATIONS = new Set(["create"]);

const basePrisma = new PrismaClient();

/**
 * Deliberate escape hatch: the raw, unscoped client. The tenant-scoping extension below
 * assumes every StaffMember/Order/etc. query is about ONE tenant, but "which stores does
 * this user belong to" (added in Phase 1's frontend module, see users/me.service.ts) is a
 * legitimate cross-tenant query about the caller's OWN memberships, which the scoped client
 * can't express at all (it would throw, demanding a tenantId that doesn't apply here).
 *
 * Use this only for that narrow class of self-lookup queries, always filtered by the
 * authenticated caller's own userId, never to browse another tenant's business data.
 */
export const prismaUnscoped = basePrisma;

/** Interactive-transaction client from the tenant-scoped `prisma` below. */
export type PrismaTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!model || !TENANT_SCOPED_MODELS.has(model)) {
          return query(args);
        }

        const tenantId = tenantContext.getTenantId();

        // findUnique/update/delete/upsert identify a row by its own unique key, so a
        // tenantId can't be safely merged into `where` without risking a Prisma error
        // (compound-unique shape mismatch) or, worse, silently matching the wrong row.
        // Rather than guess, these operations are disallowed here; call sites must use
        // findFirst / updateMany / deleteMany instead, which this middleware DOES scope.
        if (["findUnique", "findUniqueOrThrow", "update", "delete", "upsert"].includes(operation)) {
          throw new Error(
            `Tenant-scoping middleware: refusing to run ${model}.${operation}() directly. ` +
              `Use findFirst/updateMany/deleteMany with an explicit tenantId filter instead, ` +
              `so tenant isolation can be enforced rather than assumed.`
          );
        }

        if (!tenantId) {
          throw new Error(
            `Tenant-scoping middleware: ${model}.${operation}() ran with no active tenant context. ` +
              `Wrap this request in tenantContext.run(storeId, ...) before querying tenant-scoped models.`
          );
        }

        if (DATA_OPERATIONS.has(operation)) {
          const data = (args as { data?: Record<string, unknown> }).data ?? {};
          (args as { data: Record<string, unknown> }).data = { ...data, tenantId };
        } else if (WHERE_OPERATIONS.has(operation)) {
          const where = (args as { where?: Record<string, unknown> }).where ?? {};
          (args as { where: Record<string, unknown> }).where = { ...where, tenantId };
        }

        return query(args);
      },
    },
  },
});
