-- Issue 2: one public line about the shop, shown in the directory at /shop.
-- Nullable, so every existing shop is untouched and simply has no line yet.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "description" TEXT;
