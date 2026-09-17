import { Schema, Query, CallbackWithoutResultAndOptionalError } from "mongoose";

/**
 * Mongoose equivalent of the Prisma tenant-scoping middleware (Implementation_Plan.md,
 * Section 1). Every schema that stores tenant-owned documents applies this plugin so
 * find/count/update/delete queries are automatically scoped to storeId — the caller
 * still MUST pass storeId as part of the query filter; this plugin does not inject it
 * from ambient context (Mongoose has no per-request context of its own), it only
 * enforces that storeId cannot be silently omitted.
 */
export function tenantScopePlugin(schema: Schema): void {
  schema.pre(
    ["find", "findOne", "countDocuments", "updateMany", "deleteMany"],
    function (this: Query<unknown, unknown>, next: CallbackWithoutResultAndOptionalError) {
      const filter = this.getFilter();
      if (!("storeId" in filter)) {
        next(new Error("Tenant-scoped query is missing a required storeId filter."));
        return;
      }
      next();
    }
  );
}
