import { usePageMeta } from '../../lib/pageMeta'
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
 * hero's two buttons, inside a page that actually explains what the product is.
 *
 * Everyone sees it, signed in or not: it is the product's front page, and an owner may want to read
 * the pricing or send it to someone. A signed-in visitor gets one button in the navigation to where
 * they belong instead of "Log in" (LandingNav.tsx); whether they have a shop decides which.
 *
 * The page sets its own document title and meta description on mount, because this is a single-page
 * app and index.html's tags are shared with the dashboard and the storefronts.
 */
const TITLE = 'ZYRO: a free online shop for small businesses, with AI built in'
const DESCRIPTION =
  'Open a free online shop in Pakistan and let AI write your product titles and descriptions from what shoppers are really searching for. Cash on delivery, counter sales and reports included. No card needed.'

const LANDING_META = { title: TITLE, description: DESCRIPTION, type: 'website', image: '/og-image.svg' } as const

export function LandingPage() {
  usePageMeta(LANDING_META)

  return (
    <div className="min-h-screen bg-bg font-sans">
      {/* Skip link: this page is long, and a keyboard user should not have to tab the whole nav. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-[10px] focus:bg-bg focus:px-4 focus:py-2 focus:font-semibold focus:text-text"
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
