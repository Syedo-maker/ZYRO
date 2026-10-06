import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { landingPathFor, rememberedExperience, saveExperience, type Experience } from '../lib/experience'

/**
 * The front door (Issue 2). ZYRO is two products sharing one commerce core, and until now "/" sent
 * everybody to the merchant dashboard, which is wrong for most arrivals: a shopper has no shop.
 *
 * So the first question is asked plainly, once. A signed-in visitor is not asked at all; they go
 * where they belong, which is decided by whether they actually have a shop, not by a stored flag.
 */
export function LandingPage() {
  const { isLoading, isAuthenticated, stores, user } = useAuth()
  const navigate = useNavigate()

  if (isLoading) return null

  // Already signed in: there is nothing to ask. Having a shop decides it (see landingPathFor).
  if (isAuthenticated) {
    return <Navigate to={landingPathFor({ hasStore: stores.length > 0, preference: user?.preferredExperience ?? rememberedExperience() })} replace />
  }

  async function choose(experience: Experience, to: string) {
    await saveExperience(experience, false)
    navigate(to)
  }

  return (
    <div className="min-h-screen bg-bg px-4 py-12 sm:py-20">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
        <header className="flex flex-col gap-3 text-center">
          <div className="font-display text-2xl font-bold">ZYRO</div>
          <h1 className="font-display text-3xl font-bold sm:text-4xl">What would you like to do?</h1>
          <p className="text-sm text-text-secondary">Buy from a shop, or open one of your own. You can do both from the same account.</p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Shopping first: most arrivals are shoppers, and the old behaviour served them worst. */}
          <section className="flex flex-col gap-4 rounded-2xl border border-border bg-white p-6">
            <h2 className="font-display text-xl font-bold">Shop</h2>
            <p className="flex-1 text-sm text-text-secondary">
              Browse shops, add things to a basket and check out. You do not need an account to buy, and you can track an order afterwards.
            </p>
            <button
              type="button"
              onClick={() => void choose('shopper', '/shop')}
              className="inline-flex h-11 items-center justify-center rounded-[10px] bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-hover"
            >
              Start shopping
            </button>
          </section>

          <section className="flex flex-col gap-4 rounded-2xl border border-border bg-white p-6">
            <h2 className="font-display text-xl font-bold">Start a store</h2>
            <p className="flex-1 text-sm text-text-secondary">
              Set up your shop, add products, take orders online and at the counter, and use the AI tools for writing, pricing and advice.
            </p>
            <button
              type="button"
              onClick={() => void choose('owner', '/register')}
              className="inline-flex h-11 items-center justify-center rounded-[10px] border border-brand bg-white px-5 text-sm font-semibold text-brand hover:bg-brand/5"
            >
              Open a store
            </button>
          </section>
        </div>

        <p className="text-center text-sm text-text-secondary">
          Already with us?{' '}
          <Link to="/login" className="font-semibold text-brand hover:text-brand-hover">
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}
