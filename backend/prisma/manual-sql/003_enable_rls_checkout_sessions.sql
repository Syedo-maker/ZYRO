-- ZYRO: Row-Level Security for CheckoutSession (same pattern as 001 and 002)
ALTER TABLE "CheckoutSession" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_checkout_session ON "CheckoutSession"
  FOR ALL TO app_user
  USING ("tenantId" = current_setting('app.current_tenant_id', true));
