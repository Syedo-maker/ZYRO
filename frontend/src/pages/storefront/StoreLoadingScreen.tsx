import { useParams } from 'react-router-dom'
import { Spinner } from '../../components/ui/Spinner'
import { readCachedTokens, themeStyle } from '../../lib/storeTheme'

/**
 * The storefront's own loading screen, shown while a part of the shop's code is still downloading. It
 * wears the colours this browser last saw the shop in (the same cache the storefront uses), so the
 * app-wide loading screen, in Zyro's colours, never replaces a shop. It looks like the storefront's own
 * "Loading store" screen. Loaded with the app, not lazily: a loading screen must be ready at once.
 */
export function StoreLoadingScreen() {
  const { storeId = '' } = useParams()
  const tokens = readCachedTokens(storeId)
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg text-text" style={tokens ? themeStyle(tokens) : undefined}>
      <Spinner label="Loading store" />
    </div>
  )
}
