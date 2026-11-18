// The AI Shopping Assistant's conversationId is minted and held by the caller
// (Implementation_Plan.md Phase 5, Module 3; backend/openapi.yaml), the same pattern as the
// guest cart's session id (lib/guestSession.ts): a CSPRNG-generated id the backend trusts by
// possession, kept for this browser so returning to the site continues the same conversation.
const KEY = 'zyro_assistant_conversation'

let memoryFallback: string | null = null

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export function getConversationId(): string {
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

/**
 * Starts a new conversation next time. Called when the person signed in changes (sign-in, sign-out):
 * the backend trusts the id by possession, so a kept id let the next person on a shared browser
 * continue the previous shopper's chat context (audit 2026-11).
 */
export function forgetConversation(): void {
  memoryFallback = null
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Storage refused: the in-memory id above is already gone.
  }
}
