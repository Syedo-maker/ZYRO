-- ZYRO: Row-Level Security for Refund (same pattern as 001 to 003)
ALTER TABLE "Refund" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_refund ON "Refund"
  FOR ALL TO app_user
  USING ("tenantId" = current_setting('app.current_tenant_id', true));
