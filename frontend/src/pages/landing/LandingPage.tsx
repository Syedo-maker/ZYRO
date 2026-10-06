import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { landingPathFor, rememberedExperience } from '../../lib/experience'
import { LandingNav } from './LandingNav'
import { Hero } from './Hero'
import { ProblemSection } from './ProblemSection'
import { AiFeatures } from './AiFeatures'
import { FeatureGrid } from './FeatureGrid'
import { HowItWorks } from './HowItWorks'
import { ComparisonTable } from './ComparisonTable'
import { PricingSection } from './PricingSection'
import { StoreDirectoryPreview } from './StoreDirectoryPreview'
import { TrustSection } from './TrustSection'
import { FaqAccordion } from './FaqAccordion'
import { FinalCta } from './FinalCta'
import { LandingFooter } from './LandingFooter'

/**
 * The front door at "/".
 *
 * This replaced the plain "Shop or start a store?" screen: the two questions it asked are now the
 * hero's two buttons, inside a page that actually explains what the product is. The role handling
 * behind them is unchanged, so a signed-in visitor still never sees this page: whether they have a
 * shop decides where they go, not a stored preference (see lib/experience.ts).
 *
 * The page sets its own document title and meta description on mount, because this is a single-page
 * app and index.html's tags are shared with the dashboard and the storefronts.
 */
const TITLE = 'ShopMind AI: a free online shop for small businesses, with AI built in'
const DESCRIPTION =
  'Open a free online shop in Pakistan and let AI write your product titles and descriptions from what shoppers are really searching for. Cash on delivery, counter sales and reports included. No card needed.'

function useLandingMeta() {
  useEffect(() => {
    const previousTitle = document.title
    document.title = TITLE

    // Tags index.html does not carry, added here and removed again on the way out so they never
    // describe the dashboard or somebody's storefront.
    const added: HTMLMetaElement[] = []
    const meta = (attr: 'name' | 'property', key: string, content: string) => {
      const existing = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
      if (existing) {
        existing.content = content
        return
      }
      const tag = document.createElement('meta')
      tag.setAttribute(attr, key)
      tag.content = content
      document.head.appendChild(tag)
      added.push(tag)
    }

    meta('name', 'description', DESCRIPTION)
    meta('property', 'og:title', TITLE)
    meta('property', 'og:description', DESCRIPTION)
    meta('property', 'og:type', 'website')
    meta('property', 'og:image', `${window.location.origin}/og-image.svg`)
    meta('name', 'twitter:card', 'summary_large_image')

    return () => {
      document.title = previousTitle
      for (const tag of added) tag.remove()
    }
  }, [])
}

export function LandingPage() {
  const { isLoading, isAuthenticated, stores, user } = useAuth()
  useLandingMeta()

  if (isLoading) return null

  // Signed in already: there is nothing to sell them. Having a shop decides where they belong.
  if (isAuthenticated) {
    return <Navigate to={landingPathFor({ hasStore: stores.length > 0, preference: user?.preferredExperience ?? rememberedExperience() })} replace />
  }

  return (
    <div className="min-h-screen bg-lp-cream font-sans">
      {/* Skip link: this page is long, and a keyboard user should not have to tab the whole nav. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-[10px] focus:bg-lp-cream focus:px-4 focus:py-2 focus:font-semibold focus:text-lp-green"
      >
        Skip to content
      </a>

      <LandingNav />
      <main id="main">
        <Hero />
        <ProblemSection />
        <AiFeatures />
        <FeatureGrid />
        <HowItWorks />
        <ComparisonTable />
        <PricingSection />
        <StoreDirectoryPreview />
        <TrustSection />
        <FaqAccordion />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  )
}
