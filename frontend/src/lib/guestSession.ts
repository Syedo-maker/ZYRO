const KEY = 'zyro_guest_session'

let memoryFallback: string | null = null

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

/**
 * An anonymous shopper's identity: a random id sent as X-Guest-Session-Id so the server can
 * keep their cart. It carries no personal data. localStorage can be blocked (private
 * windows), so a per-page-load fallback keeps the cart working within a visit.
 */
export function getGuestSessionId(): string {
  try {
    const existing = localStorage.getItem(KEY)
    if (existing) return existing
    const created = newId()
    localStorage.setItem(KEY, created)
    return created
  } catch {
    memoryFallback ??= newId()
    return memoryFallback
  }
}
