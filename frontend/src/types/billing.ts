// Plans, billing and the platform view (Part A, revenue model), per backend/openapi.yaml.

export type PlanTier = 'FREE' | 'PRO' | 'BUSINESS'

export interface PlanInfo {
  tier: PlanTier
  name: string
  /** Monthly price in the smallest unit of `currency`; 0 for Free. */
  priceCents: number
  currency: string
  maxProducts: number
  maxStaff: number
  aiGenerationsPerMonth: number
  aiChatMessagesPerMonth: number
  analyticsMaxDays: number
  customDomain: boolean
}

export interface TopUpPackInfo {
  id: string
  name: string
  generations: number
  chatMessages: number
  priceCents: number
}

export interface UsageFigure {
  used: number
  limit: number
}

export interface BillingOverview {
  currency: string
  plans: PlanInfo[]
  topUpPacks: TopUpPackInfo[]
  /** False when the server has no Stripe keys: buying is switched off, viewing still works. */
  billingConfigured: boolean
  plan: {
    tier: PlanTier
    name: string
    status: 'free' | 'active' | 'grace'
    /** Set when a paid plan lapsed and the store is back on Free: the plan it lapsed from. */
    lapsedFrom: string | null
    paidUntil: string | null
    canManageSubscription: boolean
  }
  limits: PlanInfo
  usage: {
    products: UsageFigure
    staff: UsageFigure
    aiGenerations: UsageFigure
    aiChatMessages: UsageFigure
  }
  topUp: { generations: number; chatMessages: number }
}

/** What a 402 plan-limit or AI-quota answer carries so the UI can offer the right next step. */
export interface UpgradeHint {
  feature: string
  currentPlan: string
  requiredPlan: string | null
  limit?: number
}

export interface PlatformSummary {
  stores: number
  storesByPlan: Record<string, number>
  monthlyRecurringRevenue: number
  orders: number
  aiUsageThisMonth: { generations: number; chatMessages: number }
  economics: { id: string; priceUsd: number; worstCaseCostUsd: number; profitable: boolean }[]
}

export interface PlatformTenantRow {
  id: string
  name: string
  slug: string
  currency: string
  plan: string
  paidUntil: string | null
  createdAt: string
  products: number
  orders: number
  grossSales: number
  aiGenerationsUsed: number
  aiChatMessagesUsed: number
}
