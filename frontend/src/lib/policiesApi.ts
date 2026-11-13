import { apiFetch } from './apiClient'

export type PolicyKind = 'refund' | 'shipping' | 'privacy' | 'terms'

export interface StorePolicy {
  kind: PolicyKind
  body: string
  updatedAt: string
}

/** The order and names the storefront and Settings show the policies in. */
export const POLICY_TITLES: Record<PolicyKind, string> = {
  refund: 'Returns and refunds',
  shipping: 'Shipping and delivery',
  privacy: 'Privacy',
  terms: 'Terms of sale',
}
export const POLICY_KINDS = Object.keys(POLICY_TITLES) as PolicyKind[]

/** A shop's own policy pages: anyone reads them, the owner writes them. */
export const policiesApi = {
  list: (storeId: string) => apiFetch<{ policies: StorePolicy[] }>(`/stores/${storeId}/policies`),
  /** An empty text removes the policy. */
  set: (storeId: string, kind: PolicyKind, body: string) =>
    apiFetch<{ kind: PolicyKind; body: string | null; updatedAt: string | null }>(`/stores/${storeId}/policies/${kind}`, { method: 'PUT', body: { body } }),
}
