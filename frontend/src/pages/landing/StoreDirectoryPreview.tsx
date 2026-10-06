import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Reveal } from './Reveal'
import { directoryApi } from '../../lib/directoryApi'
import type { DirectoryStore } from '../../types/directory'

/**
 * A few real shops from the public directory.
 *
 * It shows only shops the directory itself would list, which already means their owner opted in and
 * they have a real catalogue. **The whole section removes itself** when there are fewer than three
 * such shops, rather than padding the page with invented ones: an empty row of placeholder shops
 * would be exactly the kind of fake social proof this page avoids.
 */
const MINIMUM_TO_SHOW = 3

export function StoreDirectoryPreview() {
  const [stores, setStores] = useState<DirectoryStore[] | null>(null)

  useEffect(() => {
    directoryApi
      .list({ limit: 6 })
      .then((r) => setStores(r.stores))
      .catch(() => setStores([]))
  }, [])

  // Still loading, or genuinely too few real shops to show: render nothing at all.
  if (stores === null || stores.length < MINIMUM_TO_SHOW) return null

  return (
    <section className="bg-lp-sage py-16 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <h2 className="max-w-2xl font-landing text-3xl font-extrabold leading-tight text-lp-green sm:text-4xl">
            Shops already selling on ShopMind AI
          </h2>
          <p className="mt-4 max-w-2xl text-base text-lp-green/80">Real shops, listed by their owners. Have a look around.</p>
        </Reveal>

        <ul role="list" className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stores.slice(0, 6).map((store, i) => (
            <li key={store.id}>
              <Reveal delayMs={(i % 3) * 80} className="h-full">
                <Link
                  to={`/store/${store.id}`}
                  className="flex h-full flex-col gap-3 rounded-2xl border border-lp-green/10 bg-lp-cream p-5 transition-colors hover:border-lp-green/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lp-green"
                >
                  <div className="flex items-center gap-3">
                    {store.logoUrl ? (
                      <img src={store.logoUrl} alt="" loading="lazy" className="h-10 w-10 rounded-[10px] object-cover" />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex h-10 w-10 items-center justify-center rounded-[10px] font-landing text-sm font-bold text-white"
                        style={{ backgroundColor: store.themeColor ?? '#0B3B33' }}
                      >
                        {store.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                      <h3 className="truncate font-landing text-base font-bold text-lp-green">{store.name}</h3>
                      {store.category && <p className="truncate text-xs text-lp-green/60">{store.category}</p>}
                    </div>
                  </div>
                  {store.description && <p className="line-clamp-2 text-sm text-lp-green/75">{store.description}</p>}
                  <p className="mt-auto text-xs text-lp-green/60">
                    {store.productCount} {store.productCount === 1 ? 'product' : 'products'}
                  </p>
                </Link>
              </Reveal>
            </li>
          ))}
        </ul>

        <Reveal delayMs={120}>
          <div className="mt-9">
            <Link
              to="/shop"
              className="inline-flex h-12 items-center justify-center rounded-[10px] bg-lp-green px-6 font-landing text-base font-bold text-lp-cream transition-colors hover:bg-lp-green-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lp-green"
            >
              Browse stores
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
