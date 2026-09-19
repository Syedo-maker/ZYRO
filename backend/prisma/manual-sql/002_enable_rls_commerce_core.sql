-- ZYRO: Row-Level Security for the Commerce Core Foundation tables
-- Same defense-in-depth pattern as 001_enable_rls.sql; apply after `prisma migrate deploy`.

ALTER TABLE "Location"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryLevel"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockMovement"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Customer"        ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_location ON "Location"
  FOR ALL TO app_user
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_inventory_level ON "InventoryLevel"
  FOR ALL TO app_user
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_stock_movement ON "StockMovement"
  FOR ALL TO app_user
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_customer ON "Customer"
  FOR ALL TO app_user
  USING ("tenantId" = current_setting('app.current_tenant_id', true));
