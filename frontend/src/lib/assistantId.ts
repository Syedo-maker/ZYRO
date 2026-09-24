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
