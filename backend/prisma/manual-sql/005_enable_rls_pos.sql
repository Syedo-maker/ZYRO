-- ZYRO: Row-Level Security for the POS tables (same pattern as 001 to 004).
-- OrderReturnItem has no tenantId; it is reached only through OrderReturn, like OrderItem.
ALTER TABLE "PosShift" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_posshift ON "PosShift"
  FOR ALL TO app_user
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

ALTER TABLE "OrderReturn" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_orderreturn ON "OrderReturn"
  FOR ALL TO app_user
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

ALTER TABLE "HeldSale" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_heldsale ON "HeldSale"
  FOR ALL TO app_user
  USING ("tenantId" = current_setting('app.current_tenant_id', true));