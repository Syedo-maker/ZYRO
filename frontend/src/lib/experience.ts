import { apiFetch } from './apiClient'

/**
 * Which of the two experiences a visitor chose on the landing screen (Issue 2).
 *
 * This is a routing hint and nothing else. It decides which screen opens; it never decides what
 * anyone may do. Every protected action is checked again on the server, per request and per shop,
 * so a shopper who edits this value in their browser gains nothing at all: the admin endpoints
 * still refuse them.
 */
export type Experience = 'shopper' | 'owner'

const KEY = 'zyro.experience'

/** A visitor who has not signed in yet still gets taken to the right place next time. */
export function rememberedExperience(): Experience | null {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'shopper' || value === 'owner' ? value : null
  } catch {
    // A browser with storage switched off simply gets asked again. Not an error.
    return null
  }
}

export function rememberExperience(experience: Experience): void {
  try {
    localStorage.setItem(KEY, experience)
  } catch {
    // As above: the choice still applies to this visit.
  }
}

export function forgetExperience(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to do.
  }
}

/** Saves the choice to the account as well, so it follows the user to another device. */
export async function saveExperience(experience: Experience, signedIn: boolean): Promise<void> {
  rememberExperience(experience)
  if (!signedIn) return
  try {
    await apiFetch('/users/me/preference', { method: 'PATCH', body: { experience } })
  } catch {
    // The local copy is enough to route on; failing to save a preference must not block anybody.
  }
}

/**
 * Where a signed-in user belongs after logging in.
 *
 * Having a shop is what makes somebody an owner here, not what they picked: a user with no shop
 * cannot be sent to a merchant dashboard, and a user with a shop who came to buy something is
 * taken shopping. Their stated preference only breaks the tie.
 */
export function landingPathFor(options: { hasStore: boolean; preference: Experience | null }): string {
  if (!options.hasStore) return '/shop'
  return options.preference === 'shopper' ? '/shop' : '/admin/products'
}
