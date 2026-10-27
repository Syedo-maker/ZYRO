import { apiFetch } from './apiClient'

/** Part G: voice notes for merchants. */

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
