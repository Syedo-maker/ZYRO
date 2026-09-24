import { apiFetch } from './apiClient'
import { getGuestSessionId } from './guestSession'
import type { AssistantChatResponse } from '../types/shop'

export const assistantApi = {
  /** Identifies the shopper by login when there is one, otherwise by the guest session id,
   *  same convention as cartApi (the API prefers the bearer token when both are present). */
  chat: (storeId: string, conversationId: string, message: string) =>
    apiFetch<AssistantChatResponse>(`/stores/${storeId}/assistant/chat`, {
      method: 'POST',
      body: { conversationId, message },
      headers: { 'X-Guest-Session-Id': getGuestSessionId() },
    }),
}
