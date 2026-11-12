// Applies the visitor's theme before the first paint (B5), so a light-theme visitor never sees a dark
// flash. A plain, blocking file rather than an inline script: the site's Content-Security-Policy
// allows scripts from its own origin only. The same rules as src/lib/theme.ts (tests/theme.test.ts
// runs both and checks they agree): a saved "dark", "light" or "system", otherwise dark; storage that
// cannot be read counts as nothing saved.
;(function () {
  var preference = 'dark'
  try {
    var saved = window.localStorage.getItem('zyro-theme')
    if (saved === 'dark' || saved === 'light' || saved === 'system') preference = saved
  } catch (e) {
    // A private window or blocked site data: keep the default.
  }
  var theme = preference
  if (preference === 'system') {
    var light = false
    try {
      light = window.matchMedia('(prefers-color-scheme: light)').matches
    } catch (e) {
      light = false
    }
    theme = light ? 'light' : 'dark'
  }
  var root = document.documentElement
  root.setAttribute('data-theme', theme)
  root.style.colorScheme = theme
  var meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f5f0' : '#030407')
})()

// Store Themes: a returning shopper's browser remembers each shop's published colours (src/lib/
// storeTheme.ts, key zyro-store-theme:<storeId>). Set here, before the first paint, so not even the
// loading screen shows Zyro's colours first. Every name and value passes the same allowlist as
// safeTokens in src/lib/storeTheme.ts (tests/storeTheme.test.ts checks they agree); the storefront
// replaces or clears these as soon as the server answers.
;(function () {
  try {
    var match = /^\/store\/([A-Za-z0-9_-]{1,64})(\/|$)/.exec(window.location.pathname)
    if (!match) return
    var raw = window.localStorage.getItem('zyro-store-theme:' + match[1])
    if (!raw) return
    var tokens = JSON.parse(raw)
    if (!tokens || typeof tokens !== 'object') return
    var NAME = /^--(color|font|radius|shadow)-[a-z0-9-]{1,40}$/
    var VALUE = /^[#a-zA-Z0-9 .,%()/"'-]{1,160}$/
    var FORBIDDEN = /url\s*\(|expression|javascript|@import|\\/i
    var root = document.documentElement
    for (var name in tokens) {
      if (!Object.prototype.hasOwnProperty.call(tokens, name)) continue
      var value = tokens[name]
      if (name === 'color-scheme') {
        if (value === 'dark' || value === 'light') root.style.colorScheme = value
      } else if (typeof value === 'string' && NAME.test(name) && VALUE.test(value) && !FORBIDDEN.test(value)) {
        root.style.setProperty(name, value)
      }
    }
  } catch {
    // No storage, or a damaged entry: the page simply starts in Zyro's colours.
  }
})()
