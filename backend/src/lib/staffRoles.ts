import { StaffPermission } from "@prisma/client";

/**
 * The roles an owner gives staff on the Team page, and what each one may do. Defined here, on the
 * server, so a role means the same thing whatever client asks for it and every route keeps checking
 * the permissions themselves (requirePermission). Billing, staff management, plans and AI packs, and
 * the store's settings are not on any role: they stay with the owner (requireOwner).
 *
 * - cashier: the register only.
 * - manager: everything a cashier does, plus returns and refunds, any discount, analytics and orders,
 *   and the catalogue: products, stock, categories and the AI tools (which spend the store's AI
 *   allowance, the same as the owner's own use).
 */
export const STAFF_ROLES = ["cashier", "manager"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_PERMISSIONS: Record<StaffRole, StaffPermission[]> = {
  cashier: [StaffPermission.POS_SELL],
  manager: [
    StaffPermission.POS_SELL,
    StaffPermission.REFUNDS,
    StaffPermission.DISCOUNTS_WRITE,
    StaffPermission.ANALYTICS_READ,
    StaffPermission.ORDERS_WRITE,
    StaffPermission.PRODUCTS_WRITE,
  ],
};

/** Which role a set of permissions is, or "custom" when it matches none (staff added through the API with their own list). */
export function roleOf(permissions: readonly string[]): StaffRole | "custom" {
  const have = new Set(permissions.map((p) => p.toUpperCase()));
  for (const role of STAFF_ROLES) {
    const want = ROLE_PERMISSIONS[role];
    if (want.length === have.size && want.every((p) => have.has(p))) return role;
  }
  return "custom";
}
