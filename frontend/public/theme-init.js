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
