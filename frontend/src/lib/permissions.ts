import type { MyStore } from '../types/store'

/** A store permission as the API spells it. */
export type StorePermission = 'products_write' | 'orders_write' | 'discounts_write' | 'analytics_read' | 'pos_sell' | 'inventory_write' | 'refunds'

/**
 * Whether the signed-in user may do this in the store: the owner always may, staff only with the
 * permission (GET /users/me/stores lists them). Used to offer only what will work; the server still
 * checks every request for itself.
 */
export function can(store: MyStore | null | undefined, permission: StorePermission): boolean {
  if (!store) return false
  return store.role === 'owner' || (store.permissions ?? []).includes(permission)
}
