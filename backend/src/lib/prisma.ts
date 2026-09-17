import { PrismaClient } from "@prisma/client";
import { tenantContext } from "./tenantContext";

/**
 * Models that carry a `tenantId` column (Phase 0 Module 1 schema). Every one of these
 * must be scoped to the current request's tenant on every read/write — this is the
 * Postgres-side counterpart to the Mongoose `tenantScopePlugin` from the MongoDB models.
 */
const TENANT_SCOPED_MODELS = new Set([
  "StaffMember",
  "Order",
  "Payment",
  "Shipment",
  "ShippingZone",
  "DiscountCode",
  "AiUsageQuota",
  "CartRecoveryEvent",
]);

// Operations where merging `{ tenantId }` into `where`/`data` is safe and sufficient.
const WHERE_OPERATIONS = new Set(["findMany", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy", "updateMany", "deleteMany"]);
const DATA_OPERATIONS = new Set(["create"]);

const basePrisma = new PrismaClient();

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
        // Rather than guess, these operations are disallowed here — call sites must use
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
