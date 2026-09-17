-- ShopMind AI: Row-Level Security (defense-in-depth for multi-tenancy)
-- Phase 0, Module 1: Database schema design
--
-- Prisma does not manage RLS policies natively, so this file is applied manually
-- (via `psql` or a migration hook) after `prisma migrate deploy`. It is the second
-- of two isolation layers described in Implementation_Plan.md Section 1, the first
-- being Prisma middleware that auto-scopes every query by tenantId at the app layer.
-- RLS ensures that even a bug in the app-layer middleware cannot leak cross-tenant rows.

CREATE ROLE app_user;

-- Session variable set once per request by the API's tenant-context middleware:
--   SELECT set_config('app.current_tenant_id', $1, true);

ALTER TABLE "StaffMember"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Shipment"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShippingZone"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DiscountCode"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiUsageQuota"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CartRecoveryEvent"  ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_staff_member ON "StaffMember"
  FOR ALL TO app_user
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_order ON "Order"
  FOR ALL TO app_user
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_payment ON "Payment"
  FOR ALL TO app_user
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_shipment ON "Shipment"
  FOR ALL TO app_user
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_shipping_zone ON "ShippingZone"
  FOR ALL TO app_user
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_discount_code ON "DiscountCode"
  FOR ALL TO app_user
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_ai_usage_quota ON "AiUsageQuota"
  FOR ALL TO app_user
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_cart_recovery_event ON "CartRecoveryEvent"
  FOR ALL TO app_user
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

-- "Tenant" itself is not RLS-scoped by tenantId (it IS the tenant record); access to it
-- is governed by ownerId / StaffMember membership checks in the application layer instead.
