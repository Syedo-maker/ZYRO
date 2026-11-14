-- Store Themes (2026-11): one theme row per store (draft, published, the draft's edit history) and
-- the published versions kept for restore. Rollback: prisma/rollbacks/20261112134521_store_themes.down.sql
-- CreateTable
CREATE TABLE "StoreTheme" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "publishedAt" TIMESTAMP(3),
    "history" JSONB NOT NULL,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreTheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreThemeVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "theme" JSONB NOT NULL,
    "publishedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreThemeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreTheme_tenantId_key" ON "StoreTheme"("tenantId");

-- CreateIndex
CREATE INDEX "StoreThemeVersion_tenantId_createdAt_idx" ON "StoreThemeVersion"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "StoreTheme" ADD CONSTRAINT "StoreTheme_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreThemeVersion" ADD CONSTRAINT "StoreThemeVersion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
