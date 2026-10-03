import { apiFetch } from './apiClient'
import { getGuestSessionId } from './guestSession'

/** Part G: voice notes for merchants, and haggling for shoppers. */

export interface VoiceDraft {
  kind: 'set_price' | 'set_stock' | 'add_product'
  productId?: string
  productName?: string
  price?: number
  stock?: number
  title?: string
  category?: string
  confidence: number
  warnings: string[]
}

export interface VoiceNote {
  id: string
  transcript: string
  language: string | null
  audioUrl: string
  draft: VoiceDraft | null
  /** The change in plain words, for the merchant to read before confirming. */
  summary: string | null
  problem: string | null
  status: 'pending' | 'applied' | 'discarded'
  createdAt: string
}

export interface BargainTurn {
  sessionId: string
  productId: string
  listPrice: number
  /** What the shop is offering right now. Worked out by the server, never by the assistant. */
  offer: number
  roundsLeft: number
  status: 'open' | 'agreed' | 'declined' | 'expired'
  reply: string
  settled?: boolean
  /** Present once a price is agreed: the single-use code that makes it payable. */
  deal?: { code: string; price: number; expiresAt: string }
  expiresAt: string
}

const guest = () => ({ 'X-Guest-Session-Id': getGuestSessionId() })

export const voiceApi = {
  /** Sends a recording. Comes back as a draft to confirm, never as a change already made. */
  record: async (storeId: string, blob: Blob, filename: string): Promise<VoiceNote> => {
    const form = new FormData()
    form.append('file', blob, filename)
    return apiFetch<VoiceNote>(`/stores/${storeId}/voice-notes`, { method: 'POST', body: form })
  },
  list: (storeId: string, status?: string) => apiFetch<VoiceNote[]>(`/stores/${storeId}/voice-notes${status ? `?status=${status}` : ''}`),
  apply: (storeId: string, noteId: string) => apiFetch<{ outcome: string }>(`/stores/${storeId}/voice-notes/${noteId}/apply`, { method: 'POST' }),
  discard: (storeId: string, noteId: string) => apiFetch<void>(`/stores/${storeId}/voice-notes/${noteId}/discard`, { method: 'POST' }),
}

export const bargainApi = {
  offer: (storeId: string, productId: string) => apiFetch<{ available: boolean }>(`/stores/${storeId}/products/${productId}/bargain`),
  /** The merchant's own floor price, for their product form. Needs `products_write`. */
  settings: (storeId: string, productId: string) => apiFetch<{ bargainMinPrice: number | null }>(`/stores/${storeId}/products/${productId}/bargain/settings`),
  start: (storeId: string, productId: string) => apiFetch<BargainTurn>(`/stores/${storeId}/products/${productId}/bargain`, { method: 'POST', headers: guest() }),
  turn: (storeId: string, productId: string, sessionId: string, message: string) =>
    apiFetch<BargainTurn>(`/stores/${storeId}/products/${productId}/bargain/${sessionId}/turn`, { method: 'POST', body: { message }, headers: guest() }),
}
