// Mirrors backend/src/modules/ideas/. See ideas.service.ts for the rules these shapes carry.

/** Where a keyword came from. Shown to the merchant so they can judge it for themselves. */
export type KeywordSource = 'best_sellers' | 'google_trends' | 'shopper_searches'

export interface ProductIdeaRequest {
  title?: string
  category?: string
  /** Notes for the AI, not a finished description: whatever the merchant has typed so far. */
  description?: string
  tags?: string[]
  price?: number
}

export interface ProductIdea {
  title: string
  description: string
  /**
   * The popular search words this suggestion actually contains. Checked on the server against the
   * real keyword list and against the text itself, so it is never the model's own claim.
   */
  keywordsUsed: string[]
}

export interface ProductIdeas {
  suggestions: ProductIdea[]
  /** False when no real trend data exists for this category; `notice` then says so. */
  trendDataAvailable: boolean
  sources: KeywordSource[]
  notice: string | null
  model: string
}

export interface TrendingKeywords {
  keywords: { word: string; source: KeywordSource }[]
  sources: KeywordSource[]
  trendDataAvailable: boolean
}

export const SOURCE_LABELS: Record<KeywordSource, string> = {
  best_sellers: 'what sells across ZYRO shops',
  google_trends: 'Google Trends',
  shopper_searches: 'what shoppers search for here',
}
