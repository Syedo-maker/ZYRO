/**
 * The last product a shopper opened at each store, remembered in this browser only (never sent
 * anywhere) so the store's front page can show recommendations "based on" it. Storage can be
 * blocked or full (private windows, strict settings), so every access is guarded and the feature
 * simply does not appear when it cannot be used.
 */
const key = (storeId: string) => `zyro.lastViewed.${storeId}`

export function rememberViewed(storeId: string, productId: string): void {
  try {
    localStorage.setItem(key(storeId), productId)
  } catch {
    // Not remembering is fine.
  }
}

export function lastViewed(storeId: string): string | null {
  try {
    return localStorage.getItem(key(storeId))
  } catch {
    return null
  }
}
