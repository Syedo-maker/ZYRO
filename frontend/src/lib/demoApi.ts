import { apiFetch } from './apiClient'

/**
 * The landing page's trending-suggestions demo. Public: the people it exists to convince have no
 * account yet, so no token is sent.
 *
 * `origin` is why the page can be honest about what a visitor is looking at: `live` was generated
 * for them just now, `cached` was generated for the same phrase before, and `example` is one of the
 * prepared examples, shown because the demo's budget for new generations is spent or the AI could
 * not answer. The page shows that distinction rather than passing a saved answer off as fresh.
 */
export interface DemoSuggestion {
  title: string
  description: string
  /** The popular searches this suggestion really contains, verified on the server. */
  keywordsUsed: string[]
}

export interface DemoResult {
  phrase: string
  category: string
  suggestions: DemoSuggestion[]
  /** Words only. Never a volume or a score: these are not search numbers and must not read as any. */
  keywords: string[]
  trendDataAvailable: boolean
  origin: 'live' | 'cached' | 'example'
  note: string | null
}

export interface DemoExample {
  phrase: string
  category: string
}

export const demoApi = {
  examples: () => apiFetch<{ examples: DemoExample[] }>('/demo/product-ideas/examples'),
  suggest: (phrase: string, category?: string) =>
    apiFetch<DemoResult>('/demo/product-ideas', { method: 'POST', body: { phrase, ...(category ? { category } : {}) } }),
}
