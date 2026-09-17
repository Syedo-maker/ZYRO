import { Schema, Query, CallbackWithoutResultAndOptionalError } from "mongoose";

/**
 * Mongoose equivalent of the Prisma tenant-scoping middleware (Implementation_Plan.md,
 * Section 1). Every schema that stores tenant-owned documents applies this plugin so
 * find/count/update/delete queries are automatically scoped to storeId; the caller
 * still MUST pass storeId as part of the query filter; this plugin does not inject it
 * from ambient context (Mongoose has no per-request context of its own), it only
 * enforces that storeId cannot be silently omitted.
 *
 * Every one of Mongoose's query hook names has to be listed explicitly: "find" and
 * "findOneAndUpdate" are unrelated hooks, not variants of one "query" hook. The original
 * list here (find/findOne/countDocuments/updateMany/deleteMany) missed the single-document
 * variants (findOneAndUpdate, findOneAndDelete, deleteOne, updateOne), which meant those
 * calls silently bypassed the guard entirely rather than being caught by it. Fixed during
 * Phase 1 Module 4 once product.service.ts's use of findOneAndUpdate/deleteOne exposed it.
 */
const SCOPED_QUERY_HOOKS = [
  "find",
  "findOne",
  "findOneAndUpdate",
  "findOneAndDelete",
  "findOneAndReplace",
  "countDocuments",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
] as const;

function guardFilter(this: Query<unknown, unknown>, next: CallbackWithoutResultAndOptionalError) {
  const filter = this.getFilter();
  if (!("storeId" in filter)) {
    next(new Error("Tenant-scoped query is missing a required storeId filter."));
    return;
  }
  next();
}

export function tenantScopePlugin(schema: Schema): void {
  // Mongoose's `pre()` array-of-hook-names overload only covers a narrower closed set
  // than the individual-hook-name overload does, so each hook is registered separately
  // rather than passed as one array (which TypeScript rejected).
  for (const hook of SCOPED_QUERY_HOOKS) {
    schema.pre(hook, guardFilter);
  }
}
